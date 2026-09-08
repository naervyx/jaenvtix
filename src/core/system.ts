import {existsSync} from 'node:fs';
import {arch, platform} from 'node:os';

/**
 * Normalized platform identifier used throughout Jaenvtix.
 *
 * - `'windows'`: mapped from Node.js `'win32'`.
 * - `'linux'`: mapped from Node.js `'linux'` (glibc).
 * - `'linux-musl'`: Linux with the musl libc (Alpine and derivatives);
 *   needs JDK builds linked against musl (Adoptium `alpine-linux`, Liberica).
 * - `'darwin'`: mapped from Node.js `'darwin'` (macOS).
 * - `'unknown'`: any other platform; treated as unsupported.
 */
export type PlatformType = 'windows' | 'linux' | 'linux-musl' | 'darwin' | 'unknown';

/**
 * Normalized CPU architecture identifier used throughout Jaenvtix.
 *
 * - `'x64'`: 64-bit x86.
 * - `'arm64'`: 64-bit ARM (Apple Silicon, AWS Graviton, etc.).
 * - `'unsupported'`: any other architecture; no JDK distribution is available.
 */
export type ArchitectureType = 'x64' | 'arm64' | 'unsupported';

/** Platforms for which Jaenvtix can resolve and install JDK/Maven distributions. */
export const SUPPORTED_PLATFORMS = new Set<PlatformType>(['windows', 'linux', 'linux-musl', 'darwin']);

/** CPU architectures for which JDK distributions are available. */
export const SUPPORTED_ARCHITECTURES = new Set<ArchitectureType>(['x64', 'arm64']);

/**
 * Maps each `PlatformType` to the OS name segment used in JDK download URLs.
 * `undefined` means no distribution URL can be constructed for that platform.
 */
export const DEFAULT_OS_NAMES: Readonly<Record<PlatformType, string | undefined>> = {
    windows: 'windows',
    linux: 'linux',
    // No default URL segment: most vendors ship no musl build, so they
    // self-exclude unless they override this key (e.g. Temurin's alpine-linux).
    'linux-musl': undefined,
    darwin: 'macos',
    unknown: undefined,
};

/**
 * Maps each `ArchitectureType` to the architecture segment used in JDK download URLs.
 * `undefined` means no distribution URL can be constructed for that architecture.
 */
export const DEFAULT_ARCH_NAMES: Readonly<Record<ArchitectureType, string | undefined>> = {
    x64: 'x64',
    arm64: 'aarch64',
    unsupported: undefined,
};

/** Returns `true` if Jaenvtix supports downloading JDK distributions for this architecture. */
export function isArchitectureSupported(arch: ArchitectureType): boolean {
    return SUPPORTED_ARCHITECTURES.has(arch);
}

/** Returns `true` if Jaenvtix supports downloading JDK/Maven distributions for this platform. */
export function isPlatformSupported(platform: PlatformType): boolean {
    return SUPPORTED_PLATFORMS.has(platform);
}

/**
 * Returns the archive format expected for JDK and Maven distributions on the given platform.
 * Windows distributions are shipped as `.zip`; all other platforms use `.tar.gz`.
 */
export function determineArchiveType(platform: PlatformType): 'zip' | 'tar.gz' {
    return platform === 'windows' ? 'zip' : 'tar.gz';
}

/**
 * Reads `os.arch()` and maps it to the normalized `ArchitectureType`.
 * Returns `'unsupported'` for any architecture Jaenvtix does not handle.
 */
export function getArchitecture(): ArchitectureType {
    const archType = arch();
    if (archType === 'x64') {return 'x64';}
    if (archType === 'arm64') {return 'arm64';}
    return 'unsupported';
}

/**
 * Detects the musl libc (Alpine and derivatives) on Linux by probing for the
 * musl dynamic linker, with `/etc/alpine-release` as a fallback marker.
 * Always `false` off Linux (no filesystem probe is made).
 */
export function isMusl(
    osPlatform: string = platform(),
    fileExists: (path: string) => boolean = existsSync,
): boolean {
    if (osPlatform !== 'linux') {
        return false;
    }
    return fileExists('/lib/ld-musl-x86_64.so.1')
        || fileExists('/lib/ld-musl-aarch64.so.1')
        || fileExists('/etc/alpine-release');
}

/**
 * Reads `os.platform()` and maps it to the normalized `PlatformType`.
 * Node.js reports Windows as `'win32'`; this function normalizes it to `'windows'`.
 * Linux is split into glibc (`'linux'`) and musl (`'linux-musl'`) because JDK
 * binaries are libc-specific. Returns `'unknown'` for any platform Jaenvtix
 * does not handle.
 */
export function getPlatform(
    osPlatform: string = platform(),
    muslDetector: () => boolean = () => isMusl(osPlatform),
): PlatformType {
    switch (osPlatform) {
        case 'win32': return 'windows';
        case 'linux': return muslDetector() ? 'linux-musl' : 'linux';
        case 'darwin': return 'darwin';
        default: return 'unknown';
    }
}

/**
 * Root directory where Chocolatey unpacks tool packages, or `null` off
 * Windows. Chocolatey sets `ChocolateyToolsLocation` when packages install
 * to a custom tools dir; the default package layout lives under
 * `C:\ProgramData\chocolatey\lib`.
 */
export function getChocolateyToolsRoot(
    currentPlatform: PlatformType = getPlatform(),
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    if (currentPlatform !== 'windows') {
        return null;
    }
    return env['ChocolateyToolsLocation'] ?? 'C:\\ProgramData\\chocolatey\\lib';
}

/**
 * Homebrew installation prefixes for the platform: `/opt/homebrew` (Apple
 * Silicon) and `/usr/local` (Intel) on macOS, the Linuxbrew prefix on Linux,
 * and none on Windows. Callers are expected to skip prefixes that do not
 * exist on disk.
 */
export function getHomebrewPrefixes(currentPlatform: PlatformType = getPlatform()): string[] {
    if (currentPlatform === 'darwin') {
        return ['/opt/homebrew', '/usr/local'];
    }
    if (currentPlatform === 'linux') {
        return ['/home/linuxbrew/.linuxbrew'];
    }
    return [];
}
