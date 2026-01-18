import * as os from 'node:os';

export type PlatformType = 'windows' | 'linux' | 'darwin' | 'unknown';
export type ArchitectureType = 'x64' | 'arm64' | 'unsupported';

export const SUPPORTED_PLATFORMS = new Set<PlatformType>(['windows', 'linux', 'darwin']);
export const SUPPORTED_ARCHITECTURES = new Set<ArchitectureType>(['x64', 'arm64']);

export const DEFAULT_OS_NAMES: Readonly<Record<PlatformType, string | undefined>> = {
    windows: 'windows',
    linux: 'linux',
    darwin: 'macos',
    unknown: undefined,
};

export const DEFAULT_ARCH_NAMES: Readonly<Record<ArchitectureType, string | undefined>> = {
    x64: 'x64',
    arm64: 'aarch64',
    unsupported: undefined,
};

export function isArchitectureSupported(arch: ArchitectureType): boolean {
    return SUPPORTED_ARCHITECTURES.has(arch);
}

export function isPlatformSupported(platform: PlatformType): boolean {
    return SUPPORTED_PLATFORMS.has(platform);
}

export function determineArchiveType(platform: PlatformType): 'zip' | 'tar.gz' {
    return platform === 'windows' ? 'zip' : 'tar.gz';
}

export function getArchitecture(): ArchitectureType {
    const arch = os.arch();
    if (arch === 'x64') {return 'x64';}
    if (arch === 'arm64') {return 'arm64';}
    return 'unsupported';
}

export function getPlatform(): PlatformType {
    const platform = os.platform();
    switch (platform) {
        case 'win32': return 'windows';
        case 'linux': return 'linux';
        case 'darwin': return 'darwin';
        default: return 'unknown';
    }
}
