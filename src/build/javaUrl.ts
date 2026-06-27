import {ArchitectureType, DEFAULT_ARCH_NAMES, DEFAULT_OS_NAMES, determineArchiveType, PlatformType} from '../core/system';
import {isUrlAccessible} from '../util/urlValidator';
import {FALLBACK_SUPPORTED_JAVA_VERSIONS, isLtsVersion, SupportedJavaVersions} from './redhatRuntimeReader';
import {parseJavaVersionNumber} from '../util/javaVersion';

/** A resolved JDK download: the vendor-specific download URL, file name, and archive extension. */
export interface JdkDistribution {
    name: string;
    url: string;
    extension: string;
}

interface VendorConfig {
    baseUrl: string;
    buildPath: (version: string, os: string, arch: string, ext: string) => string;
    osNames: Readonly<Record<PlatformType, string | undefined>>;
    archNames: Readonly<Record<ArchitectureType, string | undefined>>;
}

/**
 * JDK vendors supported by Jaenvtix.
 *
 * - `'oracle'`: Oracle JDK — only for Oracle-hosted versions (LTS releases 21+
 *   that the Red Hat Language Server already recognizes — see `isOracleHostedVersion`).
 * - `'corretto'`: Amazon Corretto — tried first for non-Oracle versions.
 * - `'temurin'`: Eclipse Temurin (Adoptium) — fallback when Corretto URL is not accessible.
 */
export type JdkVendor = 'oracle' | 'temurin' | 'corretto';

/**
 * Oracle hosts `https://download.oracle.com/java/{v}/latest/` binaries for
 * LTS releases starting at 21. The version must also be known to the Red Hat
 * Language Server (`supported.majors`): that confirms the release actually
 * exists, since the Oracle URL is returned without an accessibility probe.
 */
function isOracleHostedVersion(javaVersion: string, supported: SupportedJavaVersions): boolean {
    const major = parseJavaVersionNumber(javaVersion);
    return major >= 21 && isLtsVersion(major) && supported.majors.includes(major);
}

const VENDOR_CONFIGS: Readonly<Record<JdkVendor, VendorConfig>> = {
    oracle: {
        baseUrl: 'https://download.oracle.com/java',
        buildPath: (v, os, arch, ext) => `/${v}/latest/jdk-${v}_${os}-${arch}_bin.${ext}`,
        osNames: {...DEFAULT_OS_NAMES, darwin: 'macos'},
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
        osNames: {...DEFAULT_OS_NAMES, darwin: 'mac'},
        archNames: DEFAULT_ARCH_NAMES,
    },
};

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Constructs a `JdkDistribution` for the given vendor, Java version, platform and
 * architecture by applying the vendor-specific URL template.
 *
 * Business rules:
 * - Returns `null` when the vendor has no mapping for the requested platform or
 *   architecture (e.g. Oracle does not publish ARM64 binaries for all versions).
 * - Does NOT probe the URL for accessibility — the caller is responsible for that.
 */
export function buildDistribution(
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

/**
 * Resolves the best available JDK distribution for the given version, platform,
 * and architecture, probing URLs for accessibility before returning.
 *
 * Business rules:
 * - For Oracle-hosted versions (LTS 21+ recognized by the Red Hat Language
 *   Server, per `supportedVersions`), Oracle JDK is returned directly without
 *   an accessibility probe. `supportedVersions` defaults to the static list
 *   mirroring Jaenvtix 0.0.6; the orchestrator passes the dynamic one read
 *   from redhat.java so new LTS releases work without a Jaenvtix release.
 * - For all other versions, Amazon Corretto is tried first; if its URL is
 *   inaccessible, Eclipse Temurin is the fallback.
 * - Returns `null` when no accessible distribution can be found for the combination.
 */
export async function getJdkDistribution(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    supportedVersions: SupportedJavaVersions = FALLBACK_SUPPORTED_JAVA_VERSIONS,
): Promise<JdkDistribution | null> {
    if (isOracleHostedVersion(javaVersion, supportedVersions)) {
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
