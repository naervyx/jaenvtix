import * as os from "node:os";

import {ArchitectureType, SUPPORTED_ARCHITECTURES} from "../../core/type/architectureType";
import {PlatformType, SUPPORTED_PLATFORMS} from "../../core/type/platformType";

export function isArchitectureSupported(arch: ArchitectureType): boolean {
    return SUPPORTED_ARCHITECTURES.has(arch);
}

export function isPlatformSupported(plat: PlatformType): boolean {
    return SUPPORTED_PLATFORMS.has(plat);
}

export function determineArchiveType(platform: PlatformType): string {
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
