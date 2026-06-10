import {ArchitectureType, determineArchiveType, PlatformType} from '../core/system';
import {fetchTextContent} from '../util/fetchText';
import type {JdkDistribution} from './javaUrl';

/** Vendors whose latest download URL must be resolved through a metadata API. */
export type ApiJdkVendor = 'liberica' | 'zulu' | 'semeru';

export type FetchJsonFn = (url: string) => Promise<unknown>;

export interface ApiResolverDeps {
    /** Override the JSON transport. Defaults to an HTTP GET via `fetchTextContent`. */
    fetchJson?: FetchJsonFn;
}

async function defaultFetchJson(url: string): Promise<unknown> {
    return JSON.parse(await fetchTextContent(url, {timeout: 10000})) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const LIBERICA_OS_NAMES: Readonly<Record<PlatformType, string | undefined>> = {
    windows: 'windows',
    linux: 'linux',
    darwin: 'macos',
    unknown: undefined,
};

/** BellSoft models 64-bit ARM as `arch=arm` + `bitness=64`; x64 as `arch=x86` + `bitness=64`. */
const LIBERICA_ARCH_NAMES: Readonly<Record<ArchitectureType, string | undefined>> = {
    x64: 'x86',
    arm64: 'arm',
    unsupported: undefined,
};

async function resolveLiberica(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    fetchJson: FetchJsonFn,
): Promise<JdkDistribution | null> {
    const os = LIBERICA_OS_NAMES[platform];
    const archName = LIBERICA_ARCH_NAMES[arch];
    if (!os || !archName) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const url = 'https://api.bell-sw.com/v1/liberica/releases'
        + `?version-feature=${javaVersion}&version-modifier=latest&bundle-type=jdk`
        + `&package-type=${extension}&os=${os}&arch=${archName}&bitness=64`;

    const releases = await fetchJson(url);
    const first = Array.isArray(releases) ? releases[0] as unknown : undefined;
    const downloadUrl = isRecord(first) ? first['downloadUrl'] : undefined;
    if (typeof downloadUrl !== 'string' || !downloadUrl) {
        return null;
    }

    return {name: `Liberica${javaVersion}`, url: downloadUrl, extension};
}

const ZULU_OS_NAMES = LIBERICA_OS_NAMES;

/** Azul models 64-bit ARM as `arch=arm` + `hw_bitness=64`; x64 as `arch=x86` + `hw_bitness=64`. */
const ZULU_ARCH_NAMES = LIBERICA_ARCH_NAMES;

async function resolveZulu(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    fetchJson: FetchJsonFn,
): Promise<JdkDistribution | null> {
    const os = ZULU_OS_NAMES[platform];
    const archName = ZULU_ARCH_NAMES[arch];
    if (!os || !archName) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const url = 'https://api.azul.com/zulu/download/community/v1.0/bundles/latest/'
        + `?jdk_version=${javaVersion}&ext=${extension}&os=${os}&arch=${archName}`
        + '&hw_bitness=64&bundle_type=jdk&release_status=ga&javafx=false';

    const bundle = await fetchJson(url);
    const downloadUrl = isRecord(bundle) ? bundle['url'] : undefined;
    if (typeof downloadUrl !== 'string' || !downloadUrl) {
        return null;
    }

    return {name: `Zulu${javaVersion}`, url: downloadUrl, extension};
}

const SEMERU_OS_NAMES: Readonly<Record<PlatformType, string | undefined>> = {
    windows: 'windows',
    linux: 'linux',
    darwin: 'mac',
    unknown: undefined,
};

const SEMERU_ARCH_NAMES: Readonly<Record<ArchitectureType, string | undefined>> = {
    x64: 'x64',
    arm64: 'aarch64',
    unsupported: undefined,
};

async function resolveSemeru(
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    fetchJson: FetchJsonFn,
): Promise<JdkDistribution | null> {
    const os = SEMERU_OS_NAMES[platform];
    const archName = SEMERU_ARCH_NAMES[arch];
    if (!os || !archName) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const release = await fetchJson(
        `https://api.github.com/repos/ibmruntimes/semeru${javaVersion}-binaries/releases/latest`,
    );
    const assets = isRecord(release) ? release['assets'] : undefined;
    if (!Array.isArray(assets)) {
        return null;
    }

    for (const asset of assets) {
        if (!isRecord(asset)) {
            continue;
        }
        const name = asset['name'];
        const downloadUrl = asset['browser_download_url'];
        if (
            typeof name === 'string' &&
            typeof downloadUrl === 'string' &&
            name.startsWith('ibm-semeru-open-jdk_') &&
            name.includes(`_${archName}_${os}_`) &&
            name.endsWith(`.${extension}`)
        ) {
            return {name: `Semeru${javaVersion}`, url: downloadUrl, extension};
        }
    }

    return null;
}

/**
 * Resolves the latest JDK download for an API-based vendor.
 *
 * Business rules:
 * - Liberica and Zulu need their metadata APIs because direct download URLs
 *   embed the full patch version; Semeru publishes through GitHub releases.
 * - Any failure — API offline, schema drift, no matching bundle — yields
 *   `null` so the caller's vendor fallback chain continues.
 * - The JSON transport is injectable for unit tests (repo convention: no
 *   network in tests).
 */
export async function resolveApiDistribution(
    vendor: ApiJdkVendor,
    javaVersion: string,
    platform: PlatformType,
    arch: ArchitectureType,
    deps: ApiResolverDeps = {},
): Promise<JdkDistribution | null> {
    const fetchJson = deps.fetchJson ?? defaultFetchJson;

    try {
        if (vendor === 'liberica') {
            return await resolveLiberica(javaVersion, platform, arch, fetchJson);
        }
        if (vendor === 'zulu') {
            return await resolveZulu(javaVersion, platform, arch, fetchJson);
        }
        return await resolveSemeru(javaVersion, platform, arch, fetchJson);
    } catch {
        return null;
    }
}
