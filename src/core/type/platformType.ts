export type PlatformType = 'windows' | 'linux' | 'darwin' | 'unknown';
export const SUPPORTED_PLATFORMS = new Set(['windows', 'linux', 'darwin']);

export const DEFAULT_OS_NAMES: Readonly<Record<PlatformType, string | undefined>> = {
    windows: 'windows',
    linux: 'linux',
    darwin: 'macos',
    unknown: undefined,
};