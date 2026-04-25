import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildDistribution} from '../../src/build/javaUrl';

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
