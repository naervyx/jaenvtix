import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {resolveApiDistribution} from '../../src/build/vendorApiResolvers';

describe('resolveApiDistribution — Liberica', () => {
    it('queries the BellSoft API with the platform mapping and returns the first downloadUrl', async () => {
        const requested: string[] = [];
        const distribution = await resolveApiDistribution('liberica', '21', 'linux', 'x64', {
            fetchJson: async (url) => {
                requested.push(url);
                return [{downloadUrl: 'https://download.bell-sw.com/java/21.0.5+11/bellsoft-jdk21.0.5+11-linux-amd64.tar.gz'}];
            },
        });

        assert.equal(distribution?.name, 'Liberica21');
        assert.equal(distribution?.extension, 'tar.gz');
        assert.match(requested[0] ?? '', /^https:\/\/api\.bell-sw\.com\/v1\/liberica\/releases\?/);
        assert.match(requested[0] ?? '', /version-feature=21/);
        assert.match(requested[0] ?? '', /os=linux/);
        assert.match(requested[0] ?? '', /arch=x86/);
        assert.match(requested[0] ?? '', /package-type=tar\.gz/);
    });

    it('maps darwin/arm64 to macos/arm', async () => {
        const requested: string[] = [];
        await resolveApiDistribution('liberica', '17', 'darwin', 'arm64', {
            fetchJson: async (url) => { requested.push(url); return []; },
        });

        assert.match(requested[0] ?? '', /os=macos/);
        assert.match(requested[0] ?? '', /arch=arm/);
    });

    it('returns null when the API yields no releases', async () => {
        const distribution = await resolveApiDistribution('liberica', '21', 'linux', 'x64', {
            fetchJson: async () => [],
        });

        assert.equal(distribution, null);
    });
});

describe('resolveApiDistribution — Zulu', () => {
    it('queries the Azul community API and returns the bundle url', async () => {
        const requested: string[] = [];
        const distribution = await resolveApiDistribution('zulu', '21', 'windows', 'x64', {
            fetchJson: async (url) => {
                requested.push(url);
                return {url: 'https://cdn.azul.com/zulu/bin/zulu21.38.21-ca-jdk21.0.5-win_x64.zip'};
            },
        });

        assert.equal(distribution?.name, 'Zulu21');
        assert.equal(distribution?.extension, 'zip');
        assert.match(requested[0] ?? '', /^https:\/\/api\.azul\.com\/zulu\/download\/community\/v1\.0\/bundles\/latest\//);
        assert.match(requested[0] ?? '', /jdk_version=21/);
        assert.match(requested[0] ?? '', /os=windows/);
        assert.match(requested[0] ?? '', /ext=zip/);
    });

    it('returns null when the bundle response has no url', async () => {
        const distribution = await resolveApiDistribution('zulu', '21', 'linux', 'x64', {
            fetchJson: async () => ({status: 404}),
        });

        assert.equal(distribution, null);
    });
});

describe('resolveApiDistribution — Semeru', () => {
    const assets = [
        {name: 'ibm-semeru-open-jdk_x64_windows_21.0.5_11_openj9-0.48.0.zip', browser_download_url: 'https://github.com/dl/win.zip'},
        {name: 'ibm-semeru-open-jdk_x64_linux_21.0.5_11_openj9-0.48.0.tar.gz', browser_download_url: 'https://github.com/dl/linux.tar.gz'},
        {name: 'ibm-semeru-open-jdk_aarch64_mac_21.0.5_11_openj9-0.48.0.tar.gz', browser_download_url: 'https://github.com/dl/mac.tar.gz'},
        {name: 'ibm-semeru-open-jdk_x64_windows_21.0.5_11_openj9-0.48.0.msi', browser_download_url: 'https://github.com/dl/win.msi'},
    ];

    it('picks the asset matching arch, os, and archive extension', async () => {
        const distribution = await resolveApiDistribution('semeru', '21', 'darwin', 'arm64', {
            fetchJson: async () => ({assets}),
        });

        assert.equal(distribution?.url, 'https://github.com/dl/mac.tar.gz');
        assert.equal(distribution?.name, 'Semeru21');
    });

    it('prefers the zip over the msi on Windows', async () => {
        const distribution = await resolveApiDistribution('semeru', '21', 'windows', 'x64', {
            fetchJson: async () => ({assets}),
        });

        assert.equal(distribution?.url, 'https://github.com/dl/win.zip');
    });

    it('returns null when no asset matches', async () => {
        const distribution = await resolveApiDistribution('semeru', '25', 'linux', 'arm64', {
            fetchJson: async () => ({assets}),
        });

        assert.equal(distribution, null);
    });
});

describe('resolveApiDistribution — resilience', () => {
    it('returns null when the API call throws', async () => {
        const distribution = await resolveApiDistribution('liberica', '21', 'linux', 'x64', {
            fetchJson: async () => { throw new Error('API offline'); },
        });

        assert.equal(distribution, null);
    });

    it('returns null for unsupported platform/arch combinations without calling the API', async () => {
        let called = false;
        const distribution = await resolveApiDistribution('zulu', '21', 'unknown', 'x64', {
            fetchJson: async () => { called = true; return {}; },
        });

        assert.equal(distribution, null);
        assert.equal(called, false);
    });
});
