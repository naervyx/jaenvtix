import * as os from "node:os";
import * as vscode from "vscode";

export type NormalizedOperatingSystem =
    | "windows"
    | "macos"
    | "linux"
    | "android"
    | "aix"
    | "freebsd"
    | "openbsd"
    | "sunos"
    | "unknown";

export type NormalizedArchitecture =
    | "x64"
    | "arm64"
    | "arm"
    | "x86"
    | "ppc64"
    | "ppc"
    | "s390x"
    | "s390"
    | "mips"
    | "mipsel"
    | "riscv64"
    | "unknown";

export interface PlatformInfo {
    readonly os: NormalizedOperatingSystem;
    readonly arch: NormalizedArchitecture;
}

interface PlatformOverrideConfiguration {
    readonly os?: string;
    readonly arch?: string;
}

export type PlatformConfigurationReader = Pick<vscode.WorkspaceConfiguration, "get">;

export interface DetectPlatformOptions {
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly configuration?: PlatformConfigurationReader;
}

const OS_ALIASES = new Map<string, NormalizedOperatingSystem>([
    ["windows", "windows"],
    ["win32", "windows"],
    ["win", "windows"],
    ["macos", "macos"],
    ["mac", "macos"],
    ["osx", "macos"],
    ["darwin", "macos"],
    ["linux", "linux"],
    ["android", "android"],
    ["aix", "aix"],
    ["freebsd", "freebsd"],
    ["openbsd", "openbsd"],
    ["sunos", "sunos"],
]);

const ARCH_ALIASES = new Map<string, NormalizedArchitecture>([
    ["x64", "x64"],
    ["amd64", "x64"],
    ["x86_64", "x64"],
    ["ia32", "x86"],
    ["x86", "x86"],
    ["arm", "arm"],
    ["armv7l", "arm"],
    ["arm64", "arm64"],
    ["aarch64", "arm64"],
    ["ppc", "ppc"],
    ["ppc64", "ppc64"],
    ["ppc64le", "ppc64"],
    ["s390", "s390"],
    ["s390x", "s390x"],
    ["mips", "mips"],
    ["mipsel", "mipsel"],
    ["riscv64", "riscv64"],
]);

export function detectPlatform(options: DetectPlatformOptions = {}): PlatformInfo {
    const configuration = options.configuration ?? vscode.workspace.getConfiguration();
    const override = readOverride(configuration);
    const detectedOs = deriveOperatingSystem(options.platform);
    const detectedArch = deriveArchitecture(options.arch);

    return {
        os: override?.os ?? detectedOs,
        arch: override?.arch ?? detectedArch,
    };
}

function readOverride(configuration: PlatformConfigurationReader): Partial<PlatformInfo> | undefined {
    const override = configuration.get<PlatformOverrideConfiguration>("jaenvtix.platform.override");
    const normalizedOs = normalizeOperatingSystem(override?.os);
    const normalizedArch = normalizeArchitecture(override?.arch);

    if (!normalizedOs && !normalizedArch) {
        return undefined;
    }

    return {
        ...(normalizedOs ? { os: normalizedOs } : {}),
        ...(normalizedArch ? { arch: normalizedArch } : {}),
    };
}

function deriveOperatingSystem(platform?: NodeJS.Platform): NormalizedOperatingSystem {
    return normalizeOperatingSystem(platform ?? os.platform()) ?? "unknown";
}

function deriveArchitecture(architecture?: string): NormalizedArchitecture {
    return normalizeArchitecture(architecture ?? os.arch()) ?? "unknown";
}

function normalizeOperatingSystem(platform: string | undefined): NormalizedOperatingSystem | undefined {
    if (!platform) {
        return undefined;
    }

    const normalized = platform.trim().toLowerCase();

    if (!normalized) {
        return undefined;
    }

    return OS_ALIASES.get(normalized);
}

function normalizeArchitecture(architecture: string | undefined): NormalizedArchitecture | undefined {
    if (!architecture) {
        return undefined;
    }

    const normalized = architecture.trim().toLowerCase();

    if (!normalized) {
        return undefined;
    }

    return ARCH_ALIASES.get(normalized);
}
