import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildPinnedMavenDistribution, getMavenDistribution} from '../../src/build/mavenUrl';

function htmlWith(versions: string[]): string {
    const links = versions
        .flatMap((v) => [
            `<a href="https://example.org/maven/apache-maven-${v}-bin.zip">zip</a>`,
            `<a href="https://example.org/maven/apache-maven-${v}-bin.tar.gz">tar.gz</a>`,
        ])
        .join('\n');
    return `<html><body>${links}</body></html>`;
}

describe('buildPinnedMavenDistribution', () => {
    it('builds the deterministic Apache archive URL for a pinned version', () => {
        const dist = buildPinnedMavenDistribution('3.9.5', 'linux');

        assert.deepEqual(dist, {
            name: 'maven-3.9.5',
            url: 'https://archive.apache.org/dist/maven/maven-3/3.9.5/binaries/apache-maven-3.9.5-bin.tar.gz',
            extension: 'tar.gz',
            version: '3.9.5',
        });
    });

    it('uses a zip archive on windows and the maven-4 line for 4.x versions', () => {
        const dist = buildPinnedMavenDistribution('4.0.0', 'windows');

        assert.equal(dist.url, 'https://archive.apache.org/dist/maven/maven-4/4.0.0/binaries/apache-maven-4.0.0-bin.zip');
        assert.equal(dist.extension, 'zip');
    });
});

describe('getMavenDistribution', () => {
    it('picks the latest version and returns a tar.gz for linux', async () => {
        const dist = await getMavenDistribution('linux', {
            fetchPage: () => htmlWith(['3.8.6', '3.9.6', '3.10.0']),
            isUrlAccessible: async () => true,
        });

        assert.ok(dist);
        assert.equal(dist?.version, '3.10.0');
        assert.equal(dist?.extension, 'tar.gz');
        assert.match(dist?.url ?? '', /apache-maven-3\.10\.0-bin\.tar\.gz$/);
        assert.equal(dist?.name, 'maven-3.10.0');
    });

    it('returns the .zip URL for windows', async () => {
        const dist = await getMavenDistribution('windows', {
            fetchPage: () => htmlWith(['3.9.6']),
            isUrlAccessible: async () => true,
        });

        assert.equal(dist?.extension, 'zip');
        assert.match(dist?.url ?? '', /apache-maven-3\.9\.6-bin\.zip$/);
    });

    it('sorts versions numerically (3.10.0 > 3.9.6 > 3.8.0)', async () => {
        const dist = await getMavenDistribution('linux', {
            // intentionally out of order
            fetchPage: () => htmlWith(['3.8.0', '3.10.0', '3.9.6']),
            isUrlAccessible: async () => true,
        });

        assert.equal(dist?.version, '3.10.0');
    });

    it('returns null when the fetcher throws (network down / DNS / curl missing)', async () => {
        const dist = await getMavenDistribution('linux', {
            fetchPage: () => {throw new Error('curl: (6) Could not resolve host');},
            isUrlAccessible: async () => true,
        });

        assert.equal(dist, null);
    });

    it('returns null when the page has no maven-X.Y.Z links', async () => {
        const dist = await getMavenDistribution('linux', {
            fetchPage: () => '<html><body>nothing useful here</body></html>',
            isUrlAccessible: async () => true,
        });

        assert.equal(dist, null);
    });

    it('returns null when the resolved URL is not accessible', async () => {
        const dist = await getMavenDistribution('linux', {
            fetchPage: () => htmlWith(['3.9.6']),
            isUrlAccessible: async () => false,
        });

        assert.equal(dist, null);
    });

    it('uses tar.gz for darwin (macOS uses POSIX archive)', async () => {
        const dist = await getMavenDistribution('darwin', {
            fetchPage: () => htmlWith(['3.9.6']),
            isUrlAccessible: async () => true,
        });

        assert.equal(dist?.extension, 'tar.gz');
    });
});
