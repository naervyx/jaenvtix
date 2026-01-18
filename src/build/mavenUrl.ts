import {execSync} from 'node:child_process';
import {determineArchiveType, PlatformType} from '../core/system';
import {Messages} from '../util/message';
import {isUrlAccessible} from '../util/urlValidator';

export type MavenDistribution = {
    name: string;
    url: string;
    extension: string;
    version: string;
};

type MavenDownloadInfo = {
    version: string;
    zipUrl: string;
    tarGzUrl: string;
};

const MAVEN_DOWNLOAD_PAGE = 'https://maven.apache.org/download.cgi';

function fetchPage(url: string): string {
    try {
        return execSync(`curl -s -L --max-time 10 "${url}"`, {
            encoding: 'utf-8',
            timeout: 15000,
        });
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

    const zipVersions = zipMatches.map((m) => ({ url: m[1], version: m[2] }));
    const tarGzVersions = tarGzMatches.map((m) => ({ url: m[1], version: m[2] }));
    const sortByVersion = (a: { version: string }, b: { version: string }) => {
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

export async function getMavenDistribution(platform: PlatformType): Promise<MavenDistribution | null> {
    let html: string;

    try {
        html = fetchPage(MAVEN_DOWNLOAD_PAGE);
    } catch {
        return null;
    }

    const downloadInfo = parseDownloadLinks(html);

    if (!downloadInfo) {
        return null;
    }

    const extension = determineArchiveType(platform);
    const url = platform === 'windows' ? downloadInfo.zipUrl : downloadInfo.tarGzUrl;

    const accessible = await isUrlAccessible(url);
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
