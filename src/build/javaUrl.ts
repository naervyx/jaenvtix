import {ArchitectureType, DEFAULT_ARCH_NAMES, DEFAULT_OS_NAMES, determineArchiveType, PlatformType} from '../core/system';
import {isUrlAccessible} from '../util/urlValidator';

type JdkDistribution = {
    name: string;
    url: string;
    extension: string;
};

type VendorConfig = {
    baseUrl: string;
    buildPath: (version: string, os: string, arch: string, ext: string) => string;
    osNames: Readonly<Record<PlatformType, string | undefined>>;
    archNames: Readonly<Record<ArchitectureType, string | undefined>>;
};

type JdkVendor = 'oracle' | 'temurin' | 'corretto';

const ORACLE_VERSIONS = new Set(['21', '25']);

const VENDOR_CONFIGS: Readonly<Record<JdkVendor, VendorConfig>> = {
    oracle: {
        baseUrl: 'https://download.oracle.com/java',
        buildPath: (v, os, arch, ext) => `/${v}/latest/jdk-${v}_${os}-${arch}_bin.${ext}`,
        osNames: { ...DEFAULT_OS_NAMES, darwin: 'macos' },
        archNames: DEFAULT_ARCH_NAMES,
    },
    corretto: {
        baseUrl: 'https://corretto.aws/downloads/latest',
        buildPath: (v, os, arch, ext) => `/amazon-corretto-${v}-${arch}-${os}-jdk.${ext}`,
        osNames: DEFAULT_OS_NAMES,
        archNames: DEFAULT_ARCH_NAMES,
    },
    temurin: {
        baseUrl: 'https://api.adoptium.net/v3/binary/latest',
        buildPath: (v, os, arch) => `/${v}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`,
        osNames: { ...DEFAULT_OS_NAMES, darwin: 'mac' },
        archNames: DEFAULT_ARCH_NAMES,
    },
};

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildDistribution(
    vendor: JdkVendor,
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
): JdkDistribution | null {
    const config = VENDOR_CONFIGS[vendor];

    const osName = config.osNames[platform];
    const archName = config.archNames[arch];

    if (!osName || !archName) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const url = config.baseUrl + config.buildPath(javaVersion, osName, archName, extension);

    return {
        name: `${capitalize(vendor)}${javaVersion}`,
        url,
        extension,
    };
}

export async function getJdkDistribution(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
): Promise<JdkDistribution | null> {
    if (ORACLE_VERSIONS.has(javaVersion)) {
        return buildDistribution('oracle', javaVersion, platform, arch);
    }

    const corretto = buildDistribution('corretto', javaVersion, platform, arch);
    if (corretto && await isUrlAccessible(corretto.url)) {
        return corretto;
    }

    const temurin = buildDistribution('temurin', javaVersion, platform, arch);
    if (temurin && await isUrlAccessible(temurin.url)) {
        return temurin;
    }

    return null;
}
