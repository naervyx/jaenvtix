import { promises as nodeFs } from "fs";
import type { MakeDirectoryOptions } from "fs";
import * as os from "os";
import * as path from "path";

const BASE_FOLDER_NAME = ".jaenvtix";

export interface LayoutBaseOptions {
    readonly baseDir?: string;
    readonly homeDir?: string;
}

export interface EnsureBaseLayoutOptions extends LayoutBaseOptions {
    readonly fs?: Pick<typeof nodeFs, "mkdir">;
}

export interface BaseLayoutPaths {
    readonly baseDir: string;
    readonly tempDir: string;
}

export interface VersionLayoutPaths extends BaseLayoutPaths {
    readonly majorVersionDir: string;
    readonly jdkHome: string;
    readonly mavenDir: string;
    readonly mavenBin: string;
    readonly mavenWrapper: string;
    readonly mavenDaemon: string;
    readonly toolchainsFile: string;
}

export async function ensureBaseLayout(
    options: EnsureBaseLayoutOptions = {}
): Promise<BaseLayoutPaths> {
    const homeDir = options.homeDir ?? os.homedir();
    const baseDir = options.baseDir ?? path.join(homeDir, BASE_FOLDER_NAME);
    const tempDir = path.join(baseDir, "temp");
    const mkdir = options.fs?.mkdir ?? nodeFs.mkdir;

    await ensureDirectory(mkdir, baseDir);
    await ensureDirectory(mkdir, tempDir);

    return { baseDir, tempDir };
}

export function getPathsForVersion(
    version: string,
    options: LayoutBaseOptions = {}
): VersionLayoutPaths {
    const homeDir = options.homeDir ?? os.homedir();
    const baseDir = options.baseDir ?? path.join(homeDir, BASE_FOLDER_NAME);
    const tempDir = path.join(baseDir, "temp");
    const majorSegment = deriveMajorSegment(version);
    const majorVersionDir = path.join(baseDir, `jdk-${majorSegment}`);
    const jdkHome = path.join(majorVersionDir, version);
    const mavenDir = path.join(majorVersionDir, "mvn-custom");
    const mavenBin = path.join(mavenDir, "bin");
    const mavenWrapper = path.join(
        mavenBin,
        process.platform === "win32" ? "mvn-jaenvtix.cmd" : "mvn-jaenvtix"
    );
    const mavenDaemon = path.join(
        mavenBin,
        process.platform === "win32" ? "mvnd.exe" : "mvnd"
    );
    const toolchainsFile = path.join(homeDir, ".m2", "toolchains.xml");

    return {
        baseDir,
        tempDir,
        majorVersionDir,
        jdkHome,
        mavenDir,
        mavenBin,
        mavenWrapper,
        mavenDaemon,
        toolchainsFile,
    };
}

type MkdirFunction = (
    path: string,
    options?: MakeDirectoryOptions & { recursive?: boolean }
) => Promise<string | undefined>;

async function ensureDirectory(mkdir: MkdirFunction, target: string): Promise<void> {
    try {
        await mkdir(target, { recursive: true });
    } catch (error: unknown) {
        if (isNodeError(error) && error.code === "EEXIST") {
            return;
        }

        if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
            throw new Error(
                `Unable to create directory '${target}': ${error.message ?? "permission denied"}`
            );
        }

        throw error;
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return Boolean(error) && typeof error === "object" && "code" in (error as NodeJS.ErrnoException);
}

function deriveMajorSegment(version: string): string {
    const trimmed = version.trim();
    if (trimmed.length === 0) {
        throw new Error("Version value is required to resolve layout paths.");
    }

    const match = trimmed.match(/^(\d+)(\.\d+)?/);
    if (!match) {
        return trimmed;
    }

    const major = match[1];
    const minor = match[2];

    if (!major) {
        return trimmed;
    }

    if (major === "1" && minor) {
        return `${major}${minor}`;
    }

    return major;
}
