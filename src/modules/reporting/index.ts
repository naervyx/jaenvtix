import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

export interface StepMetadata {
    readonly attempt?: number;
    readonly path?: string;
}

export interface StepHandle {
    readonly id: string;
}

type AttemptStatus = "in-progress" | "success" | "failed";

type StepStatus = "in-progress" | "success" | "failed";

interface WindowAdapter {
    showInformationMessage(message: string): Thenable<unknown>;
    showErrorMessage(message: string): Thenable<unknown>;
}

interface FileSystemAdapter {
    mkdir(
        target: string,
        options?: import("node:fs").MakeDirectoryOptions & { recursive?: boolean },
    ): Promise<void>;
    writeFile(target: string, contents: string): Promise<void>;
}

export interface ReporterOptions {
    readonly reportDirectory?: string;
    readonly reportFileName?: string;
    readonly window?: WindowAdapter;
    readonly clock?: () => Date;
    readonly idGenerator?: () => string;
    readonly fileSystem?: Partial<FileSystemAdapter>;
}

export interface SerializedError {
    readonly message: string;
    readonly name?: string;
    readonly stack?: string;
}

export interface StepAttemptRecord {
    attempt: number;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    path?: string;
    status: AttemptStatus;
    error?: SerializedError;
}

export interface StepRecord {
    readonly id: string;
    readonly name: string;
    status: StepStatus;
    readonly createdAt: string;
    updatedAt: string;
    readonly attempts: StepAttemptRecord[];
}

export interface ExecutionReport {
    readonly runId: string;
    readonly createdAt: string;
    updatedAt: string;
    steps: StepRecord[];
}

export interface Reporter {
    readonly reportFilePath: string;
    startStep(name: string, metadata?: StepMetadata): Promise<StepHandle>;
    endStep(handle: StepHandle, metadata?: StepMetadata): Promise<void>;
    failStep(handle: StepHandle, error: unknown, metadata?: StepMetadata): Promise<void>;
    getReport(): ExecutionReport;
    reset(): Promise<void>;
}

const DEFAULT_REPORT_FILE_NAME = "report.json";

interface ActiveAttempt {
    readonly startedAt: Date;
    readonly record: StepAttemptRecord;
}

class ReporterImpl implements Reporter {
    readonly reportFilePath: string;

    private readonly window?: WindowAdapter;

    private readonly steps = new Map<string, StepRecord>();

    private readonly activeAttempts = new Map<string, ActiveAttempt>();

    private readonly clock: () => Date;

    private readonly idGenerator: () => string;

    private readonly reportDirectory: string;

    private readonly fs: FileSystemAdapter;

    private initialized = false;

    private report: ExecutionReport | undefined;

    private directoryReady?: Promise<void>;

    private persistQueue: Promise<void> = Promise.resolve();

    constructor(options: ReporterOptions = {}) {
        this.window = options.window;
        this.clock = options.clock ?? (() => new Date());
        this.idGenerator = options.idGenerator ?? (() => randomUUID());
        this.reportDirectory = options.reportDirectory ?? path.join(tmpdir(), "jaenvtix");
        const reportFileName = options.reportFileName ?? DEFAULT_REPORT_FILE_NAME;
        this.reportFilePath = path.join(this.reportDirectory, reportFileName);
        const defaultFileSystem: FileSystemAdapter = {
            mkdir: async (target, mkdirOptions) => {
                await fs.mkdir(target, mkdirOptions);
            },
            writeFile: async (target, contents) => {
                await fs.writeFile(target, contents);
            },
        };
        this.fs = {
            mkdir: options.fileSystem?.mkdir ?? defaultFileSystem.mkdir,
            writeFile: options.fileSystem?.writeFile ?? defaultFileSystem.writeFile,
        };
    }

    async startStep(name: string, metadata: StepMetadata = {}): Promise<StepHandle> {
        await this.ensureInitialized();
        const now = this.clock();
        const nowIso = now.toISOString();
        const stepId = this.idGenerator();
        const attemptNumber = metadata.attempt ?? 1;
        const attempt: StepAttemptRecord = {
            attempt: attemptNumber,
            startedAt: nowIso,
            path: metadata.path,
            status: "in-progress",
        };
        const step: StepRecord = {
            id: stepId,
            name,
            status: "in-progress",
            createdAt: nowIso,
            updatedAt: nowIso,
            attempts: [attempt],
        };
        this.steps.set(stepId, step);
        this.activeAttempts.set(stepId, {
            startedAt: now,
            record: attempt,
        });
        this.getMutableReport().steps.push(step);
        await this.persist();

        return { id: stepId };
    }

    async endStep(handle: StepHandle, metadata: StepMetadata = {}): Promise<void> {
        await this.ensureInitialized();
        const step = this.steps.get(handle.id);

        if (!step) {
            throw new Error(`Cannot end unknown step with id "${handle.id}".`);
        }

        const attempt = this.getActiveAttempt(handle.id);
        const now = this.clock();
        const nowIso = now.toISOString();
        const durationMs = Math.max(0, now.getTime() - attempt.startedAt.getTime());

        attempt.record.endedAt = nowIso;
        attempt.record.status = "success";
        attempt.record.durationMs = durationMs;

        if (metadata.attempt !== undefined) {
            attempt.record.attempt = metadata.attempt;
        }

        if (metadata.path !== undefined) {
            attempt.record.path = metadata.path;
        }

        step.status = "success";
        step.updatedAt = nowIso;
        this.activeAttempts.delete(handle.id);
        await this.persist();

        await this.showSuccess(step, attempt.record);
    }

    async failStep(handle: StepHandle, error: unknown, metadata: StepMetadata = {}): Promise<void> {
        await this.ensureInitialized();
        const step = this.steps.get(handle.id);

        if (!step) {
            throw new Error(`Cannot fail unknown step with id "${handle.id}".`);
        }

        const attempt = this.getActiveAttempt(handle.id);
        const now = this.clock();
        const nowIso = now.toISOString();
        const durationMs = Math.max(0, now.getTime() - attempt.startedAt.getTime());

        const serializedError = serializeError(error);
        attempt.record.endedAt = nowIso;
        attempt.record.status = "failed";
        attempt.record.durationMs = durationMs;
        attempt.record.error = serializedError;

        if (metadata.attempt !== undefined) {
            attempt.record.attempt = metadata.attempt;
        }

        if (metadata.path !== undefined) {
            attempt.record.path = metadata.path;
        }

        step.status = "failed";
        step.updatedAt = nowIso;
        this.activeAttempts.delete(handle.id);
        await this.persist();

        await this.showFailure(step, attempt.record);
    }

    getReport(): ExecutionReport {
        const report = this.getMutableReport();

        return JSON.parse(JSON.stringify(report)) as ExecutionReport;
    }

    async reset(): Promise<void> {
        this.steps.clear();
        this.activeAttempts.clear();
        const now = this.clock().toISOString();
        this.report = {
            runId: this.idGenerator(),
            createdAt: now,
            updatedAt: now,
            steps: [],
        };
        this.initialized = true;
        await this.persist();
    }

    private getMutableReport(): ExecutionReport {
        if (!this.report) {
            throw new Error("Reporter was accessed before initialization.");
        }

        return this.report;
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.reset();
        }
    }

    private getActiveAttempt(stepId: string): ActiveAttempt {
        const attempt = this.activeAttempts.get(stepId);

        if (!attempt) {
            throw new Error(`Step with id "${stepId}" is not active.`);
        }

        return attempt;
    }

    private async persist(): Promise<void> {
        const writeReport = async () => {
            const report = this.getMutableReport();
            report.updatedAt = this.clock().toISOString();
            await this.ensureDirectory();
            await this.fs.writeFile(this.reportFilePath, `${JSON.stringify(report, null, 2)}\n`);
        };

        const next = this.persistQueue.then(writeReport, writeReport);
        this.persistQueue = next.then(
            () => undefined,
            () => undefined,
        );
        await next;
    }

    private async ensureDirectory(): Promise<void> {
        if (!this.directoryReady) {
            this.directoryReady = this.fs.mkdir(this.reportDirectory, { recursive: true });
        }

        await this.directoryReady;
    }

    private async showSuccess(step: StepRecord, attempt: StepAttemptRecord): Promise<void> {
        const details = buildDetails(attempt);
        const message = `Jaenvtix: Step "${step.name}" succeeded${details ? ` (${details})` : ""}.`;
        await this.window?.showInformationMessage(message);
    }

    private async showFailure(step: StepRecord, attempt: StepAttemptRecord): Promise<void> {
        const details = buildDetails(attempt);
        const message = `Jaenvtix: Step "${step.name}" failed${details ? ` (${details})` : ""}: ${
            attempt.error?.message ?? "Unknown error"
        }`;
        await this.window?.showErrorMessage(message);
    }
}

function buildDetails(attempt: StepAttemptRecord): string {
    const details: string[] = [];

    if (attempt.attempt !== undefined) {
        details.push(`attempt ${attempt.attempt}`);
    }

    if (attempt.path) {
        details.push(`path: ${attempt.path}`);
    }

    if (attempt.durationMs !== undefined) {
        details.push(`duration: ${formatDuration(attempt.durationMs)}`);
    }

    return details.join(", ");
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1_000) {
        return `${durationMs}ms`;
    }

    const seconds = durationMs / 1_000;

    return `${seconds.toFixed(2)}s`;
}

function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack,
        };
    }

    if (typeof error === "string") {
        return { message: error };
    }

    return { message: safeStringify(error) };
}

function safeStringify(value: unknown): string {
    try {
        const stringified = JSON.stringify(value, undefined, 2);

        if (typeof stringified === "string") {
            return stringified;
        }
    } catch (error) {
        return `Unable to serialize value: ${String(error)}`;
    }

    return String(value);
}

export async function createReporter(options?: ReporterOptions): Promise<Reporter> {
    const reporter = new ReporterImpl(options);
    await reporter.reset();

    return reporter;
}
