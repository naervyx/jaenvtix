import { createHash } from "node:crypto";
import { createWriteStream, promises as fsPromises } from "node:fs";
import * as path from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";
import type * as vscode from "vscode";

import type { Logger } from "@shared/logger";
import { RetryPolicy, retry, type RetryOptions } from "@shared/retry";

interface HeaderLike {
    get(name: string): string | null;
}

interface DownloadResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: HeaderLike;
    readonly body?: unknown;
}

interface FetchInit extends Record<string, unknown> {
    signal?: AbortSignal;
}

type FetchLike = (url: string, init?: FetchInit) => Promise<DownloadResponse>;

type FileSystemMkdir = (
    target: string,
    options?: import("node:fs").MakeDirectoryOptions & { recursive?: boolean },
) => Promise<void | string>;

type FileSystemRename = (from: string, to: string) => Promise<void>;

type FileSystemUnlink = (target: string) => Promise<void>;

interface FileSystemAdapter {
    readonly mkdir: FileSystemMkdir;
    readonly rename: FileSystemRename;
    readonly unlink: FileSystemUnlink;
}

export interface DownloadProgress {
    readonly downloadedBytes: number;
    readonly totalBytes?: number;
    readonly percentage?: number;
}

export interface DownloadArtifactOptions {
    readonly destination: string;
    readonly expectedChecksum?: string;
    readonly checksumAlgorithm?: string;
    readonly configuration?: Pick<vscode.WorkspaceConfiguration, "get">;
    readonly fetchImplementation?: FetchLike;
    readonly fetchOptions?: FetchInit;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: DownloadProgress) => void;
    readonly retryOptions?: RetryOptions;
    readonly logger?: Logger;
    readonly fileSystem?: Partial<FileSystemAdapter>;
    readonly createWriteStream?: typeof createWriteStream;
    readonly temporaryPathProvider?: (destination: string) => string | Promise<string>;
}

type ChecksumPolicy = "strict" | "best-effort";

async function loadWorkspaceConfiguration(): Promise<Pick<vscode.WorkspaceConfiguration, "get"> | undefined> {
    try {
        const vscodeModule: typeof import("vscode") = await import("vscode");

        return vscodeModule.workspace.getConfiguration();
    } catch (error) {
        return undefined;
    }
}

export async function downloadArtifact(url: string, options: DownloadArtifactOptions): Promise<string> {
    const {
        destination,
        expectedChecksum,
        checksumAlgorithm,
        configuration,
        fetchImplementation,
        fetchOptions,
        signal,
        onProgress,
        retryOptions,
        logger,
        fileSystem,
        createWriteStream: createWriteStreamImpl,
        temporaryPathProvider,
    } = options;

    const fetchFn = fetchImplementation ?? (globalThis.fetch as FetchLike | undefined);

    if (!fetchFn) {
        throw new Error("Fetch API is not available in the current environment.");
    }

    const configurationReader = configuration ?? (await loadWorkspaceConfiguration());
    const checksumPolicy = resolveChecksumPolicy(configurationReader);
    const normalizedChecksum = normalizeChecksum(expectedChecksum);

    if (checksumPolicy === "strict" && !normalizedChecksum) {
        throw new Error("Checksum is required by configuration policy but was not provided.");
    }

    const fsAdapter = resolveFileSystem(fileSystem);
    const writerFactory = createWriteStreamImpl ?? createWriteStream;
    const tempProvider = temporaryPathProvider ?? defaultTemporaryPath;
    const retryPolicy = RetryPolicy.fromConfiguration(configuration);
    const combinedRetryOptions = buildRetryOptions(retryPolicy, retryOptions, logger, signal);

    return retry(async () => {
        const temporaryPath = await Promise.resolve(tempProvider(destination));
        await ensureDirectory(fsAdapter, path.dirname(destination));
        await ensureDirectory(fsAdapter, path.dirname(temporaryPath));

        try {
            throwIfAborted(signal);
            const response = await fetchFn(url, buildFetchInit(fetchOptions, signal));

            if (!response.ok) {
                throw new Error(
                    `Failed to download artifact: ${response.status} ${response.statusText || ""}`.trim(),
                );
            }

            const body = response.body;

            if (!body) {
                throw new Error("Download response did not include a body.");
            }

            const totalBytes = parseContentLength(response.headers.get("content-length"));
            const progress = createProgressTracker(totalBytes, onProgress);
            const hash = normalizedChecksum
                ? createHash(resolveChecksumAlgorithm(normalizedChecksum, checksumAlgorithm))
                : undefined;

            const writeStream = writerFactory(temporaryPath);

            try {
                progress.notify(0);
                for await (const chunk of toAsyncIterable(body)) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
                    hash?.update(buffer);
                    await writeChunk(writeStream, buffer);
                    progress.increment(buffer.length);
                }
            } finally {
                writeStream.end();
                await finished(writeStream);
            }

            if (hash) {
                const digest = hash.digest("hex");

                if (digest.toLowerCase() !== normalizedChecksum) {
                    throw new Error(
                        `Downloaded file checksum ${digest} does not match expected checksum ${normalizedChecksum}.`,
                    );
                }
            }

            await moveFileWithOverwrite(fsAdapter, temporaryPath, destination);

            return destination;
        } catch (error) {
            await cleanupTemporaryFile(fsAdapter, logger, temporaryPath);
            throw error;
        }
    }, combinedRetryOptions);
}

function resolveChecksumPolicy(configuration: Pick<vscode.WorkspaceConfiguration, "get"> | undefined): ChecksumPolicy {
    const policy = configuration?.get<string>("jaenvtix.checksumPolicy");

    if (policy === "strict" || policy === "best-effort") {
        return policy;
    }

    return "best-effort";
}

function normalizeChecksum(value: string | undefined): string | undefined {
    const trimmed = value?.trim();

    if (!trimmed) {
        return undefined;
    }

    return trimmed.toLowerCase();
}

function resolveChecksumAlgorithm(checksum: string, override?: string): string {
    if (override && override.trim()) {
        return override.trim();
    }

    if (checksum.length === 32) {
        return "md5";
    }

    if (checksum.length === 40) {
        return "sha1";
    }

    if (checksum.length === 64) {
        return "sha256";
    }

    return "sha256";
}

function resolveFileSystem(adapter?: Partial<FileSystemAdapter>): FileSystemAdapter {
    return {
        mkdir: adapter?.mkdir ?? (async (target, options) => {
            await fsPromises.mkdir(target, { ...options, recursive: true });
        }),
        rename: adapter?.rename ?? ((from, to) => fsPromises.rename(from, to)),
        unlink: adapter?.unlink ?? ((target) => fsPromises.unlink(target)),
    };
}

async function ensureDirectory(fileSystem: FileSystemAdapter, directory: string): Promise<void> {
    if (!directory || directory === ".") {
        return;
    }

    const root = path.parse(directory).root;

    if (directory === root) {
        return;
    }

    await fileSystem.mkdir(directory, { recursive: true });
}

function defaultTemporaryPath(destination: string): string {
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return `${destination}.download-${unique}`;
}

function buildFetchInit(
    fetchOptions: FetchInit | undefined,
    signal: AbortSignal | undefined,
): FetchInit | undefined {
    if (!fetchOptions && !signal) {
        return undefined;
    }

    if (!fetchOptions) {
        return { signal };
    }

    if (!signal || fetchOptions.signal) {
        return { ...fetchOptions };
    }

    return { ...fetchOptions, signal };
}

function createProgressTracker(
    totalBytes: number | undefined,
    onProgress?: (progress: DownloadProgress) => void,
): { notify(downloaded: number): void; increment(delta: number): void } {
    let downloaded = 0;

    const notify = (bytes: number): void => {
        downloaded = bytes;

        if (!onProgress) {
            return;
        }

        const progress: DownloadProgress = {
            downloadedBytes: downloaded,
            ...(typeof totalBytes === "number" && Number.isFinite(totalBytes)
                ? { totalBytes, percentage: totalBytes > 0 ? downloaded / totalBytes : undefined }
                : {}),
        };

        onProgress(progress);
    };

    return {
        notify,
        increment: (delta: number) => {
            notify(downloaded + delta);
        },
    };
}

function parseContentLength(value: string | null): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed;
}

async function writeChunk(stream: import("node:fs").WriteStream, chunk: Buffer): Promise<void> {
    if (stream.write(chunk)) {
        return;
    }

    await once(stream, "drain");
}

async function cleanupTemporaryFile(
    fileSystem: FileSystemAdapter,
    logger: Logger | undefined,
    temporaryPath: string,
): Promise<void> {
    try {
        await fileSystem.unlink(temporaryPath);
    } catch (error) {
        if (isIgnorableFsError(error)) {
            return;
        }

        const message =
            error instanceof Error && error.message
                ? error.message
                : "Unable to remove temporary download artifact.";

        if (logger) {
            logger.warn("Failed to remove temporary download artifact", {
                path: temporaryPath,
                error: message,
            });
        } else {
            console.warn(
                `Failed to remove temporary download artifact at ${temporaryPath}: ${message}`,
            );
        }
    }
}

function isIgnorableFsError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const nodeError = error as NodeJS.ErrnoException;

    return nodeError.code === "ENOENT";
}

function toAsyncIterable(body: unknown): AsyncIterable<unknown> {
    if (typeof body === "object" && body !== null) {
        const asyncIterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator];

        if (typeof asyncIterator === "function") {
            return body as AsyncIterable<unknown>;
        }

        const getReader = (body as { getReader?: () => unknown }).getReader;

        if (typeof getReader === "function" && typeof (ReadableFromWeb as unknown) === "function") {
            return (ReadableFromWeb as (source: unknown) => AsyncIterable<unknown>)(body);
        }
    }

    throw new Error("Unsupported response body stream type.");
}

const ReadableFromWeb: ((source: unknown) => AsyncIterable<unknown>) | undefined =
    typeof Readable.fromWeb === "function"
        ? (source: unknown) => Readable.fromWeb(source as never)
        : undefined;

function buildRetryOptions(
    policy: RetryPolicy,
    options: RetryOptions | undefined,
    logger: Logger | undefined,
    signal: AbortSignal | undefined,
): RetryOptions {
    const combined = policy.createOptions(options);

    const userOnRetry = combined.onRetry;

    combined.onRetry = (error, attempt) => {
        if (isAbortError(error, signal)) {
            throw error;
        }

        userOnRetry?.(error, attempt);

        if (logger) {
            logger.warn("Retrying download after failure", {
                attempt,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    return combined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal) {
        return;
    }

    if (typeof signal.throwIfAborted === "function") {
        signal.throwIfAborted();

        return;
    }

    if (signal.aborted) {
        throw createAbortError(signal);
    }
}

function createAbortError(signal: AbortSignal | undefined): Error {
    const reason = signal?.reason;

    if (reason instanceof Error) {
        return reason;
    }

    if (reason !== undefined) {
        if (typeof DOMException === "function" && reason instanceof DOMException) {
            return reason;
        }

        const error = new Error(
            typeof reason === "string" ? reason : "The operation was aborted.",
        );
        (error as Error & { name?: string }).name = "AbortError";

        return error;
    }

    if (typeof DOMException === "function") {
        return new DOMException("The operation was aborted.", "AbortError");
    }

    const error = new Error("The operation was aborted.");
    (error as Error & { name?: string }).name = "AbortError";

    return error;
}

function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
    if (!error) {
        return signal?.aborted === true;
    }

    if (signal?.aborted && signal.reason && error === signal.reason) {
        return true;
    }

    if (typeof DOMException === "function" && error instanceof DOMException) {
        return error.name === "AbortError";
    }

    if (typeof error === "object") {
        const name = (error as { name?: unknown }).name;

        if (name === "AbortError") {
            return true;
        }
    }

    if (signal?.aborted) {
        return true;
    }

    return false;
}

async function moveFileWithOverwrite(
    fileSystem: FileSystemAdapter,
    from: string,
    to: string,
): Promise<void> {
    try {
        await fileSystem.rename(from, to);
    } catch (error) {
        if (!isOverwriteError(error)) {
            throw error;
        }

        await removeExistingDestination(fileSystem, to);
        await fileSystem.rename(from, to);
    }
}

function isOverwriteError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const nodeError = error as NodeJS.ErrnoException;

    return nodeError.code === "EEXIST";
}

async function removeExistingDestination(
    fileSystem: FileSystemAdapter,
    destination: string,
): Promise<void> {
    try {
        await fileSystem.unlink(destination);
    } catch (error) {
        if (isIgnorableFsError(error)) {
            return;
        }

        throw error;
    }
}
