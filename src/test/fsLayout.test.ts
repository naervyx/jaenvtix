import * as assert from "assert";
import type * as fs from "fs";
import { promises as nodeFs } from "fs";
import * as os from "os";
import * as path from "path";

import { cleanupTempDirectory, ensureBaseLayout, getPathsForVersion } from "../modules/fsLayout";

type MkdirOptions = fs.MakeDirectoryOptions & { recursive?: boolean };
type FsPromises = typeof import("fs/promises");

class MemoryFs {
    private readonly created = new Set<string>();
    private readonly denied = new Set<string>();

    public deny(target: fs.PathLike): void {
        this.denied.add(normalizePath(target));
    }

    public async mkdir(target: fs.PathLike, options?: MkdirOptions): Promise<string | undefined> {
        const normalized = normalizePath(target);
        if (this.denied.has(normalized)) {
            const error = new Error("permission denied") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
        }

        if (this.created.has(normalized)) {
            if (options?.recursive) {
                return normalized;
            }

            const error = new Error("already exists") as NodeJS.ErrnoException;
            error.code = "EEXIST";
            throw error;
        }

        this.created.add(normalized);
        return normalized;
    }

    public has(target: fs.PathLike): boolean {
        return this.created.has(normalizePath(target));
    }

    public size(): number {
        return this.created.size;
    }

    public asPromises(): Pick<FsPromises, "mkdir"> {
        return {
            mkdir: this.mkdir.bind(this) as FsPromises["mkdir"],
        };
    }
}

function normalizePath(target: fs.PathLike): string {
    const stringValue = typeof target === "string" ? target : target.toString();
    return path.posix.normalize(stringValue.replace(/\\/g, "/"));
}

suite("fsLayout", () => {
    test("getPathsForVersion exposes canonical directories", () => {
        const homeDir = "/users/dev";
        const version = "21.0.2+13";

        const paths = getPathsForVersion(version, { homeDir });
        const baseDir = path.join(homeDir, ".jaenvtix");

        assert.strictEqual(paths.baseDir, baseDir);
        assert.strictEqual(paths.tempDir, path.join(baseDir, "temp"));
        assert.strictEqual(paths.majorVersionDir, path.join(baseDir, "jdk-21"));
        assert.strictEqual(paths.jdkHome, path.join(baseDir, "jdk-21", version));
        assert.strictEqual(paths.mavenDir, path.join(baseDir, "jdk-21", "mvn-custom"));
        assert.strictEqual(paths.mavenBin, path.join(baseDir, "jdk-21", "mvn-custom", "bin"));
        assert.strictEqual(paths.toolchainsFile, path.join(homeDir, ".m2", "toolchains.xml"));

        const expectedWrapper = path.join(
            baseDir,
            "jdk-21",
            "mvn-custom",
            "bin",
            process.platform === "win32" ? "mvn-jaenvtix.cmd" : "mvn-jaenvtix"
        );
        assert.strictEqual(paths.mavenWrapper, expectedWrapper);

        const expectedDaemon = path.join(
            baseDir,
            "jdk-21",
            "mvn-custom",
            "bin",
            process.platform === "win32" ? "mvnd.exe" : "mvnd"
        );
        assert.strictEqual(paths.mavenDaemon, expectedDaemon);
    });

    test("getPathsForVersion keeps legacy 1.x major identifiers", () => {
        const homeDir = "/users/dev";
        const version = "1.8.0_202";

        const paths = getPathsForVersion(version, { homeDir });
        const baseDir = path.join(homeDir, ".jaenvtix");

        assert.strictEqual(paths.majorVersionDir, path.join(baseDir, "jdk-1.8"));
        assert.strictEqual(paths.jdkHome, path.join(baseDir, "jdk-1.8", version));
    });

    test("ensureBaseLayout creates base directories idempotently", async () => {
        const homeDir = "/users/dev";
        const memoryFs = new MemoryFs();
        const fsAdapter = memoryFs.asPromises();

        const result = await ensureBaseLayout({ homeDir, fs: fsAdapter });
        const baseDir = path.join(homeDir, ".jaenvtix");

        assert.strictEqual(result.baseDir, baseDir);
        assert.strictEqual(result.tempDir, path.join(baseDir, "temp"));
        assert.ok(memoryFs.has(baseDir));
        assert.ok(memoryFs.has(path.join(baseDir, "temp")));

        await ensureBaseLayout({ homeDir, fs: fsAdapter });
        assert.strictEqual(memoryFs.size(), 2);
    });

    test("ensureBaseLayout surfaces permission errors", async () => {
        const homeDir = "/users/locked";
        const baseDir = path.join(homeDir, ".jaenvtix");
        const memoryFs = new MemoryFs();
        memoryFs.deny(baseDir);
        const fsAdapter = memoryFs.asPromises();

        await assert.rejects(
            () => ensureBaseLayout({ homeDir, fs: fsAdapter }),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Unable to create directory/);
                return true;
            }
        );
    });

    test("cleanupTempDirectory removes stale artifacts", async () => {
        const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), "jaenvtix-fs-layout-"));
        const tempDir = path.join(root, "temp");
        await nodeFs.mkdir(tempDir);
        await nodeFs.writeFile(path.join(tempDir, "file.txt"), "content", "utf8");
        await nodeFs.mkdir(path.join(tempDir, "nested"));
        await nodeFs.writeFile(path.join(tempDir, "nested", "inner.txt"), "nested", "utf8");

        try {
            await cleanupTempDirectory({ tempDir, fs: nodeFs });

            const entries = await nodeFs.readdir(tempDir);
            assert.deepStrictEqual(entries, [], "temporary directory should be empty");
        } finally {
            await nodeFs.rm(root, { recursive: true, force: true });
        }
    });

    test("cleanupTempDirectory reports when inspection fails", async () => {
        const error = new Error("permission denied");
        await assert.rejects(
            () =>
                cleanupTempDirectory({
                    tempDir: "/tmp/missing",
                    fs: {
                        readdir: async () => {
                            throw error;
                        },
                        rm: async () => {
                            throw new Error("rm should not be invoked");
                        },
                    },
                }),
            (thrown: unknown) => {
                assert.ok(thrown instanceof Error);
                assert.match(thrown.message, /Unable to inspect temporary directory/);
                return true;
            }
        );
    });
});
