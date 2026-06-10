import {determineArchiveType, PlatformType} from '../core/system';
import {fetchTextContent} from '../util/fetchText';
import {Messages} from '../util/message';
import {isUrlAccessible} from '../util/urlValidator';

/** A resolved Maven distribution: the download URL, archive format, and version string. */
export interface MavenDistribution {
    name: string;
    url: string;
    extension: string;
    version: string;
}

interface MavenDownloadInfo {
    version: string;
    zipUrl: string;
    tarGzUrl: string;
}

const MAVEN_DOWNLOAD_PAGE = 'https://maven.apache.org/download.cgi';

export type FetchPageFn = (url: string) => string | Promise<string>;
export type IsUrlAccessibleFn = (url: string) => Promise<boolean>;

export interface MavenDistributionDeps {
    /** Override how the Maven download page HTML is fetched. Defaults to an async HTTP GET. */
    fetchPage?: FetchPageFn;
    /** Override the URL accessibility probe. Defaults to a HEAD request. */
    isUrlAccessible?: IsUrlAccessibleFn;
}

async function defaultFetchPage(url: string): Promise<string> {
    try {
        return await fetchTextContent(url, {timeout: 10000});
    } catch {
        throw new Error(Messages.Error.MAVEN_PAGE_FETCH_FAILED(url));
    }
}

function parseDownloadLinks(html: string): MavenDownloadInfo | null {
    const zipPattern = /href=["'](https:\/\/[^"']+\/apache-maven-(\d+\.\d+\.\d+)-bin\.zip)["']/gi;
    const tarGzPattern = /href=["'](https:\/\/[^"']+\/apache-maven-(\d+\.\d+\.\d+)-bin\.tar\.gz)["']/gi;

    const zipMatches = [...html.matchAll(zipPattern)];
    const tarGzMatches = [...html.matchAll(tarGzPattern)];

    if (zipMatches.length === 0 || tarGzMatches.length === 0) {
        return null;
    }

    const zipVersions = zipMatches.map((m) => ({url: m[1], version: m[2]}));
    const tarGzVersions = tarGzMatches.map((m) => ({url: m[1], version: m[2]}));
    const sortByVersion = (a: {version: string}, b: {version: string}) => {
        const partsA = a.version.split('.').map(Number);
        const partsB = b.version.split('.').map(Number);

        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] ?? 0;
            const numB = partsB[i] ?? 0;
            if (numA !== numB) {
                return numB - numA;
            }
        }
        return 0;
    };

    zipVersions.sort(sortByVersion);
    tarGzVersions.sort(sortByVersion);

    const latestZip = zipVersions[0];
    const latestTarGz = tarGzVersions[0];

    if (!latestZip || !latestTarGz) {
        return null;
    }

    const version = sortByVersion(latestZip, latestTarGz) <= 0
        ? latestZip.version
        : latestTarGz.version;

    const zipUrl = zipVersions.find((v) => v.version === version)?.url ?? latestZip.url;
    const tarGzUrl = tarGzVersions.find((v) => v.version === version)?.url ?? latestTarGz.url;

    return {
        version,
        zipUrl,
        tarGzUrl,
    };
}

/**
 * Fetches the Apache Maven download page and returns the latest available
 * distribution for the given platform.
 *
 * Business rules:
 * - Scrapes `maven.apache.org/download.cgi` for `.zip` and `.tar.gz` download
 *   links, then selects the highest version using numeric segment comparison.
 * - Windows receives a `.zip` archive; all other platforms receive `.tar.gz`.
 * - Probes the resolved URL for accessibility before returning; returns `null`
 *   if the URL is unreachable.
 * - Returns `null` on any failure: fetch error, page with no recognizable links,
 *   or inaccessible URL — the caller treats this as a terminal warning.
 * - Accepts `deps` for dependency injection (custom fetch or probe function)
 *   to keep the function unit-testable without network access.
 */
export async function getMavenDistribution(
    platform: PlatformType,
    deps: MavenDistributionDeps = {}
): Promise<MavenDistribution | null> {
    const fetchPage = deps.fetchPage ?? defaultFetchPage;
    const probe = deps.isUrlAccessible ?? isUrlAccessible;

    let html: string;

    try {
        html = await fetchPage(MAVEN_DOWNLOAD_PAGE);
    } catch {
        return null;
    }

    const downloadInfo = parseDownloadLinks(html);

    if (!downloadInfo) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const url = platform === 'windows' ? downloadInfo.zipUrl : downloadInfo.tarGzUrl;

    const accessible = await probe(url);
    if (!accessible) {
        return null;
    }

    return {
        name: `maven-${downloadInfo.version}`,
        url,
        extension,
        version: downloadInfo.version,
    };
}
