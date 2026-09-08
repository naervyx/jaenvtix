import {ArchitectureType, DEFAULT_ARCH_NAMES, DEFAULT_OS_NAMES, determineArchiveType, PlatformType} from '../core/system';
import {isUrlAccessible} from '../util/urlValidator';
import {FALLBACK_SUPPORTED_JAVA_VERSIONS, isLtsVersion, SupportedJavaVersions} from './redhatRuntimeReader';
import {parseJavaVersionNumber} from '../util/javaVersion';
import {ApiJdkVendor, resolveApiDistribution} from './vendorApiResolvers';

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
 * Template vendors (URL built locally):
 * - `'oracle'`: Oracle JDK, only for Oracle-hosted versions (LTS releases 21+
 *   that the Red Hat Language Server already recognizes; see `isOracleHostedVersion`).
 * - `'corretto'`: Amazon Corretto.
 * - `'temurin'`: Eclipse Temurin (Adoptium).
 * - `'microsoft'`: Microsoft Build of OpenJDK, LTS releases only.
 *
 * API vendors (URL resolved through a metadata API; see `vendorApiResolvers`):
 * - `'liberica'`: BellSoft Liberica.
 * - `'zulu'`: Azul Zulu.
 * - `'semeru'`: IBM Semeru (OpenJ9).
 */
export type JdkVendor = 'oracle' | 'temurin' | 'corretto' | 'microsoft' | 'liberica' | 'zulu' | 'semeru';

export type TemplateJdkVendor = 'oracle' | 'temurin' | 'corretto' | 'microsoft';

/** Value of `jaenvtix.preferredJdkVendor`: a concrete vendor or `'auto'`. */
export type JdkVendorPreference = JdkVendor | 'auto';

const ALL_VENDOR_PREFERENCES: readonly JdkVendorPreference[] =
    ['auto', 'oracle', 'temurin', 'corretto', 'microsoft', 'liberica', 'zulu', 'semeru'];

/** Maps a raw setting value to a valid preference; anything unknown means `'auto'`. */
export function normalizeVendorPreference(value: unknown): JdkVendorPreference {
    return ALL_VENDOR_PREFERENCES.find((preference) => preference === value) ?? 'auto';
}

/**
 * Oracle hosts `https://download.oracle.com/java/{v}/latest/` binaries for
 * LTS releases starting at 21. The version must also be known to the Red Hat
 * Language Server (`supported.majors`): that confirms the release actually exists.
 */
function isOracleHostedVersion(javaVersion: string, supported: SupportedJavaVersions): boolean {
    const major = parseJavaVersionNumber(javaVersion);
    return major >= 21 && isLtsVersion(major) && supported.majors.includes(major);
}

/** Microsoft publishes its OpenJDK build for LTS releases only (11, 17, 21, ...). */
function isMicrosoftHostedVersion(javaVersion: string): boolean {
    const major = parseJavaVersionNumber(javaVersion);
    return major >= 11 && isLtsVersion(major);
}

/** Adoptium ships native Windows ARM64 binaries only from Java 21 onward. */
function isTemurinHostedCombo(javaVersion: string, platform: PlatformType, arch: ArchitectureType): boolean {
    if (platform === 'windows' && arch === 'arm64') {
        return parseJavaVersionNumber(javaVersion) >= 21;
    }
    return true;
}

const VENDOR_CONFIGS: Readonly<Record<TemplateJdkVendor, VendorConfig>> = {
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
        osNames: {...DEFAULT_OS_NAMES, darwin: 'mac', 'linux-musl': 'alpine-linux'},
        archNames: DEFAULT_ARCH_NAMES,
    },
    microsoft: {
        baseUrl: 'https://aka.ms/download-jdk',
        buildPath: (v, os, arch, ext) => `/microsoft-jdk-${v}-${os}-${arch}.${ext}`,
        osNames: {...DEFAULT_OS_NAMES, darwin: 'macos'},
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
 * - Does NOT probe the URL for accessibility; the caller is responsible for that.
 */
export function buildDistribution(
    vendor: TemplateJdkVendor,
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
 * Vendor order attempted per preference. The preferred vendor goes first;
 * the rest is its documented fallback chain. `auto` preserves the historic
 * behaviour: Oracle (when hosted), then Corretto, then Temurin.
 */
const VENDOR_FALLBACK_CHAINS: Readonly<Record<JdkVendor, readonly JdkVendor[]>> = {
    oracle: ['oracle', 'corretto', 'temurin'],
    temurin: ['temurin', 'corretto', 'liberica'],
    corretto: ['corretto', 'temurin', 'liberica'],
    liberica: ['liberica', 'temurin', 'corretto'],
    microsoft: ['microsoft', 'temurin', 'corretto'],
    zulu: ['zulu', 'temurin', 'corretto'],
    semeru: ['semeru', 'temurin', 'corretto'],
};

/**
 * `auto` keeps the historic Oracle → Corretto → Temurin order; Microsoft and
 * Liberica are last resorts only reached when the primary vendors cannot host
 * the combination (e.g. Java 17 on native Windows ARM64, where Adoptium only
 * ships 21+, or musl Linux where Corretto has no build).
 */
const AUTO_CHAIN: readonly JdkVendor[] = ['oracle', 'corretto', 'temurin', 'microsoft', 'liberica'];

function isTemplateVendor(vendor: JdkVendor): vendor is TemplateJdkVendor {
    return vendor === 'oracle' || vendor === 'corretto' || vendor === 'temurin' || vendor === 'microsoft';
}

export type ResolveApiDistributionFn = (
    vendor: ApiJdkVendor,
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
) => Promise<JdkDistribution | null>;

export interface JdkResolutionOptions {
    /**
     * Versions the Red Hat Language Server recognizes; gates Oracle hosting.
     * Defaults to the static list mirroring Jaenvtix 0.0.6; the orchestrator
     * passes the dynamic one read from redhat.java so new LTS releases work
     * without a Jaenvtix release.
     */
    supportedVersions?: SupportedJavaVersions;
    /** Vendor preference from `jaenvtix.preferredJdkVendor`. Defaults to `'auto'`. */
    preferredVendor?: JdkVendorPreference;
    /** Override the URL accessibility probe (tests). Defaults to a HEAD request. */
    isUrlAccessible?: (url: string) => Promise<boolean>;
    /** Override the API-based vendor resolver (tests). Defaults to the live one. */
    resolveApiDistribution?: ResolveApiDistributionFn;
}

/**
 * Resolves the best available JDK distribution for the given version, platform,
 * and architecture, walking the preferred vendor's fallback chain.
 *
 * Business rules:
 * - The chain starts at `preferredVendor` and falls back per
 *   `VENDOR_FALLBACK_CHAINS`; `'auto'` keeps the historic Oracle → Corretto →
 *   Temurin order.
 * - Vendors that cannot host the version are skipped without a network call:
 *   Oracle requires an LTS 21+ recognized by redhat.java, Microsoft requires
 *   an LTS 11+.
 * - Every candidate URL is probed for accessibility; the first reachable one
 *   wins, so an unreachable preferred vendor falls back automatically.
 * - API-based vendors (Liberica, Zulu, Semeru) that fail to resolve are
 *   skipped the same way.
 * - Returns `null` when no accessible distribution can be found for the combination.
 */
export async function getJdkDistribution(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    options: JdkResolutionOptions = {},
): Promise<JdkDistribution | null> {
    const supported = options.supportedVersions ?? FALLBACK_SUPPORTED_JAVA_VERSIONS;
    const preference = options.preferredVendor ?? 'auto';
    const probe = options.isUrlAccessible ?? isUrlAccessible;
    const resolveApi = options.resolveApiDistribution
        ?? ((vendor, version, os, cpu) => resolveApiDistribution(vendor, version, os, cpu));

    const chain = preference === 'auto' ? AUTO_CHAIN : VENDOR_FALLBACK_CHAINS[preference];

    for (const vendor of chain) {
        if (vendor === 'oracle' && !isOracleHostedVersion(javaVersion, supported)) {
            continue;
        }
        if (vendor === 'microsoft' && !isMicrosoftHostedVersion(javaVersion)) {
            continue;
        }
        if (vendor === 'temurin' && !isTemurinHostedCombo(javaVersion, platform, arch)) {
            continue;
        }

        const distribution = isTemplateVendor(vendor)
            ? buildDistribution(vendor, javaVersion, platform, arch)
            : await resolveApi(vendor, javaVersion, platform, arch);

        if (distribution && await probe(distribution.url)) {
            return distribution;
        }
    }

    return null;
}
