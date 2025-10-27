import * as assert from 'assert';
import type { MakeDirectoryOptions } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
        createReporter,
        type ExecutionReport,
        type Reporter,
        type StepHandle,
} from '../modules/reporting';

interface TestWindow {
        readonly informationMessages: string[];
        readonly errorMessages: string[];
        readonly api: {
                showInformationMessage(message: string): Promise<void>;
                showErrorMessage(message: string): Promise<void>;
        };
}

interface Deferred<T> {
        readonly promise: Promise<T>;
        resolve(value: T | PromiseLike<T>): void;
        reject(error: unknown): void;
}

function createTestWindow(): TestWindow {
        const informationMessages: string[] = [];
        const errorMessages: string[] = [];

        return {
                informationMessages,
                errorMessages,
                api: {
                        async showInformationMessage(message: string): Promise<void> {
                                informationMessages.push(message);
                        },
                        async showErrorMessage(message: string): Promise<void> {
                                errorMessages.push(message);
                        },
                },
        };
}

function createIncrementalClock(start = Date.UTC(2024, 0, 1, 0, 0, 0), stepMs = 100): () => Date {
        let current = start;

        return () => {
                const date = new Date(current);
                current += stepMs;

                return date;
        };
}

function createDeterministicIdGenerator(): () => string {
        let counter = 0;

        return () => {
                counter += 1;

                return `step-${counter}`;
        };
}

async function readReport(filePath: string): Promise<ExecutionReport> {
        const content = await fs.readFile(filePath, 'utf8');

        return JSON.parse(content) as ExecutionReport;
}

function createDeferred<T>(): Deferred<T> {
        let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
        let reject: ((error: unknown) => void) | undefined;

        const promise = new Promise<T>((promiseResolve, promiseReject) => {
                resolve = promiseResolve;
                reject = promiseReject;
        });

        if (!resolve || !reject) {
                throw new Error('Deferred promise was not initialized.');
        }

        return {
                promise,
                resolve,
                reject,
        };
}

async function waitForPendingWrites(
        pendingWrites: readonly Deferred<void>[],
        expectedCount: number,
): Promise<void> {
        while (pendingWrites.length < expectedCount) {
                await new Promise((resolve) => {
                        setTimeout(resolve, 0);
                });
        }
}

suite('Reporting module', () => {
        test('persists structured events with errors and paths', async () => {
                const window = createTestWindow();
                const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'reporting-test-'));
                const reporter = await createReporter({
                        reportDirectory: tempDirectory,
                        window: window.api,
                        clock: createIncrementalClock(),
                        idGenerator: createDeterministicIdGenerator(),
                });

                const failedStep: StepHandle = await reporter.startStep('Download artifact', {
                        path: '/tmp/archive.zip',
                });
                await reporter.failStep(failedStep, new Error('Checksum mismatch'), {
                        attempt: 2,
                        path: '/tmp/archive.zip',
                });

                const successStep: StepHandle = await reporter.startStep('Extract archive', {
                        path: '/tmp/extracted',
                });
                await reporter.endStep(successStep, {
                        attempt: 1,
                        path: '/tmp/extracted',
                });

                const report = await readReport(reporter.reportFilePath);

                assert.strictEqual(report.steps.length, 2, 'should persist both steps');

                const [firstStep, secondStep] = report.steps;
                assert.ok(firstStep);
                assert.ok(secondStep);

                assert.strictEqual(firstStep.name, 'Download artifact');
                assert.strictEqual(firstStep.status, 'failed');
                assert.strictEqual(firstStep.attempts.length, 1);
                const firstAttempt = firstStep.attempts[0];
                assert.ok(firstAttempt);
                assert.strictEqual(firstAttempt.attempt, 2);
                assert.strictEqual(firstAttempt.path, '/tmp/archive.zip');
                assert.strictEqual(firstAttempt.status, 'failed');
                assert.ok(firstAttempt.durationMs && firstAttempt.durationMs > 0);
                assert.strictEqual(firstAttempt.error?.message, 'Checksum mismatch');

                assert.strictEqual(secondStep.name, 'Extract archive');
                assert.strictEqual(secondStep.status, 'success');
                assert.strictEqual(secondStep.attempts.length, 1);
                const secondAttempt = secondStep.attempts[0];
                assert.ok(secondAttempt);
                assert.strictEqual(secondAttempt.attempt, 1);
                assert.strictEqual(secondAttempt.path, '/tmp/extracted');
                assert.strictEqual(secondAttempt.status, 'success');

                assert.strictEqual(window.errorMessages.length, 1, 'should surface failure message');
                assert.strictEqual(window.informationMessages.length, 1, 'should surface success message');
                const errorMessage = window.errorMessages[0];
                const infoMessage = window.informationMessages[0];
                assert.ok(errorMessage);
                assert.ok(infoMessage);
                assert.match(errorMessage, /Download artifact/);
                assert.match(infoMessage, /Extract archive/);
        });

        test('resets reports between executions', async () => {
                const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'reporting-test-reset-'));
                const window = createTestWindow();

                const firstReporter: Reporter = await createReporter({
                        reportDirectory: tempDirectory,
                        window: window.api,
                        clock: createIncrementalClock(),
                        idGenerator: createDeterministicIdGenerator(),
                });
                const step = await firstReporter.startStep('Initial step');
                await firstReporter.endStep(step);

                const firstReport = await readReport(firstReporter.reportFilePath);
                assert.strictEqual(firstReport.steps.length, 1);

                const secondReporter: Reporter = await createReporter({
                        reportDirectory: tempDirectory,
                        window: window.api,
                        clock: createIncrementalClock(),
                        idGenerator: createDeterministicIdGenerator(),
                });

                const secondReport = await readReport(secondReporter.reportFilePath);
                assert.strictEqual(secondReport.steps.length, 0, 'should reset persisted data between runs');
        });

        test('serializes report writes to avoid lost step data', async () => {
                const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'reporting-serialize-test-'));
                const pendingWrites: Deferred<void>[] = [];
                let activeWrites = 0;
                let maxActiveWrites = 0;
                let writeCalls = 0;
                let latestWrite = '';

                const fileSystem = {
                        async mkdir(
                                target: string,
                                options?: MakeDirectoryOptions & { recursive?: boolean },
                        ) {
                                await fs.mkdir(target, options);
                        },
                        async writeFile(target: string, contents: string) {
                                writeCalls += 1;
                                activeWrites += 1;
                                maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
                                let deferred: Deferred<void> | undefined;

                                try {
                                        if (writeCalls > 3) {
                                                deferred = createDeferred<void>();
                                                pendingWrites.push(deferred);
                                                await deferred.promise;
                                        }

                                        latestWrite = contents;
                                        await fs.writeFile(target, contents);
                                } finally {
                                        activeWrites -= 1;
                                }
                        },
                };

                const reporter = await createReporter({
                        reportDirectory: tempDirectory,
                        fileSystem,
                        clock: createIncrementalClock(),
                        idGenerator: createDeterministicIdGenerator(),
                });

                const first = await reporter.startStep('First');
                const second = await reporter.startStep('Second');

                const finishFirst = reporter.endStep(first);
                const finishSecond = reporter.endStep(second);

                await waitForPendingWrites(pendingWrites, 1);
                assert.strictEqual(maxActiveWrites, 1, 'should not perform parallel writes');

                pendingWrites[0]?.resolve();
                await waitForPendingWrites(pendingWrites, 2);
                assert.strictEqual(maxActiveWrites, 1, 'writes should remain serialized');

                pendingWrites[1]?.resolve();

                await Promise.all([finishFirst, finishSecond]);

                const persisted = JSON.parse(latestWrite) as ExecutionReport;
                assert.strictEqual(persisted.steps.length, 2);
                assert.deepStrictEqual(
                        persisted.steps.map((step) => step.status),
                        ['success', 'success'],
                );
        });
});
