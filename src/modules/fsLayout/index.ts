import { promises as nodeFs, type MakeDirectoryOptions } from "fs";
import * as os from "os";
import * as path from "path";

import type { NormalizedOperatingSystem } from "../platformInfo";

const BASE_FOLDER_NAME = ".jaenvtix";

export interface LayoutBaseOptions {
    readonly baseDir?: string;
    readonly homeDir?: string;
    readonly platform?: NodeJS.Platform | NormalizedOperatingSystem;
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

export interface CleanupTempDirectoryOptions {
    readonly tempDir: string;
    readonly fs?: Pick<typeof nodeFs, "readdir" | "rm">;
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
    const windowsExecutables = isWindowsPlatform(options.platform);
    const mavenWrapper = path.join(
        mavenBin,
        windowsExecutables ? "mvn-jaenvtix.cmd" : "mvn-jaenvtix"
    );
    const mavenDaemon = path.join(
        mavenBin,
        windowsExecutables ? "mvnd.exe" : "mvnd"
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
export async function cleanupTempDirectory(options: CleanupTempDirectoryOptions): Promise<void> {
    const tempDir = options.tempDir;
    const fsAdapter = options.fs ?? nodeFs;

    let entries: string[];

    try {
        entries = await fsAdapter.readdir(tempDir);
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return;
        }

        throw new Error(
            `Unable to inspect temporary directory '${tempDir}': ${formatFsErrorMessage(error)}`
        );
    }

    for (const entry of entries) {
        const target = path.join(tempDir, entry);

        try {
            await fsAdapter.rm(target, { recursive: true, force: true });
        } catch (error) {
            if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EACCES")) {
                continue;
            }

            throw new Error(
                `Unable to remove temporary artifact '${target}': ${formatFsErrorMessage(error)}`
            );
        }
    }
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

function formatFsErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function isWindowsPlatform(
    platform: NodeJS.Platform | NormalizedOperatingSystem | undefined,
): boolean {
    if (!platform) {
        return process.platform === "win32";
    }

    const normalized = platform.toLowerCase();

    return normalized === "win32" || normalized === "windows";
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
