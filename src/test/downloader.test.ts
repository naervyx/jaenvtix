import * as assert from "assert";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import type { Logger } from "@shared/logger";

import { downloadArtifact, type DownloadProgress } from "../modules/downloader";

interface ConfigurationReader {
    get<T>(section: string): T | undefined;
}

class TestConfiguration implements ConfigurationReader {
    public constructor(private readonly values: Record<string, unknown> = {}) {}

    public get<T>(section: string): T | undefined {
        return this.values[section] as T | undefined;
    }
}

interface TestHeaders {
    get(name: string): string | null;
}

class MockHeaders implements TestHeaders {
    public constructor(private readonly values: Record<string, string> = {}) {}

    public get(name: string): string | null {
        const value = this.values[name.toLowerCase()];

        return value ?? null;
    }
}

interface TestResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: TestHeaders;
    readonly body: AsyncIterable<Uint8Array>;
}

type FetchStub = (url: string) => Promise<TestResponse>;

function createResponse(data: Buffer, headers: Record<string, string> = {}): TestResponse {
    const headerBag = new MockHeaders(headers);

    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: headerBag,
        body: Readable.from([data]) as AsyncIterable<Uint8Array>,
    };
}

async function createTempDirectory(): Promise<string> {
    const prefix = path.join(os.tmpdir(), "jaenvtix-downloader-test-");

    return fs.mkdtemp(prefix);
}

suite("downloader", () => {
    const checksumPolicyKey = "jaenvtix.checksumPolicy";

    test("downloadArtifact writes file and reports progress", async () => {
        const tempDir = await createTempDirectory();
        const destination = path.join(tempDir, "artifact.bin");
        const payload = Buffer.from("artifact-bytes");
        const checksum = createHash("md5").update(payload).digest("hex");
        const progressEvents: DownloadProgress[] = [];

        const fetch: FetchStub = async () =>
            createResponse(payload, { "content-length": String(payload.length) });

        try {
            await downloadArtifact("https://example.com/artifact", {
                destination,
                expectedChecksum: checksum,
                configuration: new TestConfiguration({ [checksumPolicyKey]: "best-effort" }),
                fetchImplementation: fetch,
                onProgress: (progress) => {
                    progressEvents.push(progress);
                },
            });

            const file = await fs.readFile(destination);
            assert.deepStrictEqual(file, payload);
            assert.ok(progressEvents.length > 0, "progress events should be recorded");

            const lastEvent = progressEvents[progressEvents.length - 1]!;
            assert.strictEqual(lastEvent.downloadedBytes, payload.length);
            assert.strictEqual(lastEvent.totalBytes, payload.length);
            assert.strictEqual(lastEvent.percentage, 1);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("downloadArtifact retries failed downloads before succeeding", async () => {
        const tempDir = await createTempDirectory();
        const destination = path.join(tempDir, "retry.bin");
        const payload = Buffer.from("retry-payload");
        const checksum = createHash("md5").update(payload).digest("hex");
        let attempt = 0;

        const fetch: FetchStub = async () => {
            attempt += 1;

            if (attempt < 3) {
                throw new Error("network unavailable");
            }

            return createResponse(payload);
        };

        try {
            await downloadArtifact("https://example.com/retry", {
                destination,
                expectedChecksum: checksum,
                configuration: new TestConfiguration({ [checksumPolicyKey]: "best-effort" }),
                fetchImplementation: fetch,
                retryOptions: { retries: 4 },
            });

            const file = await fs.readFile(destination);
            assert.deepStrictEqual(file, payload);
            assert.strictEqual(attempt, 3);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("downloadArtifact surfaces checksum mismatches and warns on cleanup failure", async () => {
        const tempDir = await createTempDirectory();
        const destination = path.join(tempDir, "artifact.bin");
        const temporaryPath = `${destination}.partial`;
        const payload = Buffer.from("corrupted-payload");
        let warned = false;
        let warnedPayload: Record<string, unknown> | undefined;

        const logger: Logger = {
            debug: () => undefined,
            info: () => undefined,
            warn: (_message, fields) => {
                warned = true;
                warnedPayload = fields;
            },
            error: () => undefined,
            child: () => logger,
        };

        const fetch: FetchStub = async () =>
            createResponse(payload, { "content-length": String(payload.length) });

        const failingFileSystem = {
            unlink: async () => {
                const error = new Error("permission denied") as NodeJS.ErrnoException;
                error.code = "EACCES";
                throw error;
            },
        };

        try {
            await assert.rejects(
                () =>
                    downloadArtifact("https://example.com/bad-checksum", {
                        destination,
                        expectedChecksum: "0000",
                        configuration: new TestConfiguration({ [checksumPolicyKey]: "best-effort" }),
                        fetchImplementation: fetch,
                        temporaryPathProvider: () => temporaryPath,
                        fileSystem: failingFileSystem,
                        logger,
                    }),
                (error: unknown) => {
                    assert.ok(error instanceof Error);
                    assert.match(error.message, /checksum/i);

                    return true;
                },
            );

            assert.ok(warned, "logger.warn should be called when cleanup fails");
            assert.ok(warnedPayload);
            assert.strictEqual(warnedPayload?.path, temporaryPath);

            const exists = await fileExists(temporaryPath);
            assert.ok(exists, "temporary file should remain when cleanup fails");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});

async function fileExists(target: string): Promise<boolean> {
    try {
        await fs.stat(target);

        return true;
    } catch (error) {
        if (error && typeof error === "object" && "code" in (error as NodeJS.ErrnoException)) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
        }

        throw error;
    }
}
