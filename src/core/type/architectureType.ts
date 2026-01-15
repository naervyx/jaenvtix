export type ArchitectureType = 'x64' | 'arm64' | 'unsupported';
export const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);

export const DEFAULT_ARCH_NAMES: Readonly<Record<ArchitectureType, string | undefined>> = {
    x64: 'x64',
    arm64: 'aarch64',
    unsupported: undefined,
};