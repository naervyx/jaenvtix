import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildDistribution, getJdkDistribution, normalizeVendorPreference} from '../../src/build/javaUrl';
import type {SupportedJavaVersions} from '../../src/build/redhatRuntimeReader';

describe('buildDistribution — Oracle (Java 21 / 25)', () => {
    it('emits the documented Oracle download URL with macos OS spelling on darwin', () => {
        const distribution = buildDistribution('oracle', '21', 'darwin', 'arm64');
        assert.deepEqual(distribution, {
            name: 'Oracle21',
            url: 'https://download.oracle.com/java/21/latest/jdk-21_macos-aarch64_bin.tar.gz',
            extension: 'tar.gz',
        });
    });

    it('emits a windows zip URL for Java 25 on x64', () => {
        const distribution = buildDistribution('oracle', '25', 'windows', 'x64');
        assert.deepEqual(distribution, {
            name: 'Oracle25',
            url: 'https://download.oracle.com/java/25/latest/jdk-25_windows-x64_bin.zip',
            extension: 'zip',
        });
    });

    it('emits a linux tar.gz URL for Java 21 on x64', () => {
        const distribution = buildDistribution('oracle', '21', 'linux', 'x64');
        assert.deepEqual(distribution, {
            name: 'Oracle21',
            url: 'https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.tar.gz',
            extension: 'tar.gz',
        });
    });
});

describe('buildDistribution — Amazon Corretto (Java < 21)', () => {
    it('uses the corretto.aws latest URL with x64 + linux for Java 11', () => {
        const distribution = buildDistribution('corretto', '11', 'linux', 'x64');
        assert.deepEqual(distribution, {
            name: 'Corretto11',
            url: 'https://corretto.aws/downloads/latest/amazon-corretto-11-x64-linux-jdk.tar.gz',
            extension: 'tar.gz',
        });
    });

    it('uses macos OS spelling and aarch64 arch for Java 17 on Apple Silicon', () => {
        const distribution = buildDistribution('corretto', '17', 'darwin', 'arm64');
        assert.deepEqual(distribution, {
            name: 'Corretto17',
            url: 'https://corretto.aws/downloads/latest/amazon-corretto-17-aarch64-macos-jdk.tar.gz',
            extension: 'tar.gz',
        });
    });

    it('produces a zip URL on windows', () => {
        const distribution = buildDistribution('corretto', '8', 'windows', 'x64');
        assert.deepEqual(distribution, {
            name: 'Corretto8',
            url: 'https://corretto.aws/downloads/latest/amazon-corretto-8-x64-windows-jdk.zip',
            extension: 'zip',
        });
    });
});

describe('buildDistribution — Eclipse Temurin (Adoptium)', () => {
    it('uses the api.adoptium.net binary endpoint with mac OS spelling on darwin', () => {
        const distribution = buildDistribution('temurin', '17', 'darwin', 'arm64');
        assert.deepEqual(distribution, {
            name: 'Temurin17',
            url: 'https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse',
            extension: 'tar.gz',
        });
    });

    it('uses the windows OS spelling and zip extension on windows', () => {
        const distribution = buildDistribution('temurin', '11', 'windows', 'x64');
        assert.equal(
            distribution?.url,
            'https://api.adoptium.net/v3/binary/latest/11/ga/windows/x64/jdk/hotspot/normal/eclipse',
        );
        assert.equal(distribution?.extension, 'zip');
    });
});

describe('buildDistribution — invalid combinations', () => {
    it('returns null when the platform has no vendor mapping', () => {
        assert.equal(buildDistribution('corretto', '17', 'unknown', 'x64'), null);
    });

    it('returns null when the architecture is unsupported', () => {
        assert.equal(buildDistribution('temurin', '17', 'linux', 'unsupported'), null);
    });
});

const allReachable = async () => true;

describe('getJdkDistribution — Oracle-hosted version gate', () => {
    it('resolves Java 21 to Oracle directly with the default supported versions', async () => {
        const distribution = await getJdkDistribution('21', 'linux', 'x64', {isUrlAccessible: allReachable});

        assert.equal(distribution?.name, 'Oracle21');
        assert.equal(distribution?.url, 'https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.tar.gz');
    });

    it('resolves a future LTS to Oracle once redhat.java declares support for it', async () => {
        const withJava29: SupportedJavaVersions = {
            names: ['JavaSE-21', 'JavaSE-25', 'JavaSE-29'],
            majors: [21, 25, 29],
            ltsList: [21, 25, 29],
            latestLts: 29,
            latestAvailable: 29,
        };

        const distribution = await getJdkDistribution('29', 'windows', 'x64', {
            supportedVersions: withJava29,
            isUrlAccessible: allReachable,
        });

        assert.equal(distribution?.name, 'Oracle29');
        assert.equal(distribution?.url, 'https://download.oracle.com/java/29/latest/jdk-29_windows-x64_bin.zip');
    });
});

describe('getJdkDistribution — vendor preference chains', () => {
    const libericaResolver = (url: string) => async (vendor: string) =>
        vendor === 'liberica' ? {name: 'Liberica21', url, extension: 'tar.gz'} : null;

    it('returns the preferred vendor first when its URL is reachable', async () => {
        const distribution = await getJdkDistribution('21', 'linux', 'x64', {
            preferredVendor: 'liberica',
            isUrlAccessible: allReachable,
            resolveApiDistribution: libericaResolver('https://download.bell-sw.com/java/21.0.5/bellsoft-jdk21.0.5-linux-amd64.tar.gz'),
        });

        assert.equal(distribution?.name, 'Liberica21');
    });

    it('falls back to Temurin when the preferred vendor URL is unreachable', async () => {
        const libericaUrl = 'https://download.bell-sw.com/java/21.0.5/bellsoft-jdk21.0.5-linux-amd64.tar.gz';
        const distribution = await getJdkDistribution('21', 'linux', 'x64', {
            preferredVendor: 'liberica',
            isUrlAccessible: async (url) => url !== libericaUrl,
            resolveApiDistribution: libericaResolver(libericaUrl),
        });

        assert.equal(distribution?.name, 'Temurin21');
    });

    it('resolves Java 17 to Microsoft when preferred', async () => {
        const distribution = await getJdkDistribution('17', 'windows', 'x64', {
            preferredVendor: 'microsoft',
            isUrlAccessible: allReachable,
        });

        assert.equal(distribution?.name, 'Microsoft17');
        assert.equal(distribution?.url, 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip');
    });

    it('skips Microsoft for non-LTS versions and falls back to Temurin', async () => {
        const distribution = await getJdkDistribution('23', 'linux', 'x64', {
            preferredVendor: 'microsoft',
            isUrlAccessible: allReachable,
        });

        assert.equal(distribution?.name, 'Temurin23');
    });

    it('keeps the historic auto behaviour: Oracle for 21+ LTS', async () => {
        const distribution = await getJdkDistribution('21', 'darwin', 'arm64', {
            preferredVendor: 'auto',
            isUrlAccessible: allReachable,
        });

        assert.equal(distribution?.name, 'Oracle21');
    });

    it('resolves Zulu through its API resolver when preferred', async () => {
        const distribution = await getJdkDistribution('21', 'linux', 'x64', {
            preferredVendor: 'zulu',
            isUrlAccessible: allReachable,
            resolveApiDistribution: async (vendor) =>
                vendor === 'zulu'
                    ? {name: 'Zulu21', url: 'https://cdn.azul.com/zulu/bin/zulu21.38.21-ca-jdk21.0.5-linux_x64.tar.gz', extension: 'tar.gz'}
                    : null,
        });

        assert.equal(distribution?.name, 'Zulu21');
    });

    it('returns null when every vendor in the chain is unreachable', async () => {
        const distribution = await getJdkDistribution('17', 'linux', 'x64', {
            preferredVendor: 'corretto',
            isUrlAccessible: async () => false,
            resolveApiDistribution: async () => null,
        });

        assert.equal(distribution, null);
    });
});

describe('normalizeVendorPreference', () => {
    it('keeps valid preferences and maps anything unknown to auto', () => {
        assert.equal(normalizeVendorPreference('liberica'), 'liberica');
        assert.equal(normalizeVendorPreference('auto'), 'auto');
        assert.equal(normalizeVendorPreference('libreica-typo'), 'auto');
        assert.equal(normalizeVendorPreference(undefined), 'auto');
        assert.equal(normalizeVendorPreference(42), 'auto');
    });
});
