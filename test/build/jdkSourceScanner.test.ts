import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {scanChocolatey, scanHomebrew} from '../../src/build/jdkSourceScanner';
import {getChocolateyToolsRoot, getHomebrewPrefixes} from '../../src/core/system';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

function placeJavac(jdkHome: string, javacName: string): void {
    mkdirSync(join(jdkHome, 'bin'), {recursive: true});
    writeFileSync(join(jdkHome, 'bin', javacName), '');
}

describe('scanChocolatey', () => {
    let root: string;

    before(async () => { root = await createTempDir('jaenvtix-choco-'); });
    after(async () => { await removeTempDir(root); });

    it('detects a versioned JDK under the lib layout (<pkg>/tools/jdk-21)', () => {
        placeJavac(join(root, 'openjdk', 'tools', 'jdk-21'), 'javac.exe');

        const results = scanChocolatey(root);

        assert.deepEqual(results, [{
            jdkHome: join(root, 'openjdk', 'tools', 'jdk-21'),
            source: 'chocolatey',
        }]);
    });

    it('detects a JDK directly under the ChocolateyToolsLocation layout', () => {
        placeJavac(join(root, 'temurin-17'), 'javac.exe');

        const results = scanChocolatey(root);

        assert.ok(results.some((candidate) => candidate.jdkHome === join(root, 'temurin-17')));
    });

    it('ignores JDK-named directories without bin/javac.exe', () => {
        mkdirSync(join(root, 'corretto-empty', 'tools'), {recursive: true});

        const results = scanChocolatey(root);

        assert.ok(results.every((candidate) => !candidate.jdkHome.includes('corretto-empty')));
    });

    it('ignores packages whose name does not suggest a JDK', () => {
        placeJavac(join(root, 'nodejs', 'tools'), 'javac.exe');

        const results = scanChocolatey(root);

        assert.ok(results.every((candidate) => !candidate.jdkHome.includes('nodejs')));
    });

    it('returns an empty list when the root is null or missing', () => {
        assert.deepEqual(scanChocolatey(null), []);
        assert.deepEqual(scanChocolatey(join(root, 'does-not-exist')), []);
    });
});

describe('scanHomebrew', () => {
    let prefix: string;

    before(async () => { prefix = await createTempDir('jaenvtix-brew-'); });
    after(async () => { await removeTempDir(prefix); });

    it('detects an opt/openjdk@21 formula with a direct bin/javac', () => {
        placeJavac(join(prefix, 'opt', 'openjdk@21'), 'javac');

        const results = scanHomebrew([prefix]);

        assert.ok(results.some((candidate) =>
            candidate.jdkHome === join(prefix, 'opt', 'openjdk@21') && candidate.source === 'homebrew'));
    });

    it('detects a versioned Cellar formula (Cellar/openjdk/21.0.1)', () => {
        placeJavac(join(prefix, 'Cellar', 'openjdk', '21.0.1'), 'javac');

        const results = scanHomebrew([prefix]);

        assert.ok(results.some((candidate) =>
            candidate.jdkHome === join(prefix, 'Cellar', 'openjdk', '21.0.1')));
    });

    it('resolves the macOS bundle layout (libexec/openjdk.jdk/Contents/Home)', () => {
        const formulaDir = join(prefix, 'opt', 'openjdk@17');
        const bundleHome = join(formulaDir, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
        placeJavac(bundleHome, 'javac');

        const results = scanHomebrew([prefix]);

        assert.ok(results.some((candidate) => candidate.jdkHome === bundleHome));
    });

    it('ignores non-openjdk formulae', () => {
        placeJavac(join(prefix, 'opt', 'maven'), 'javac');

        const results = scanHomebrew([prefix]);

        assert.ok(results.every((candidate) => !candidate.jdkHome.includes('maven')));
    });

    it('returns an empty list when there are no prefixes', () => {
        assert.deepEqual(scanHomebrew([]), []);
    });
});

describe('package manager roots per platform', () => {
    it('getChocolateyToolsRoot returns null off Windows', () => {
        assert.equal(getChocolateyToolsRoot('linux'), null);
        assert.equal(getChocolateyToolsRoot('darwin'), null);
    });

    it('getChocolateyToolsRoot prefers ChocolateyToolsLocation over the lib default', () => {
        assert.equal(getChocolateyToolsRoot('windows', {ChocolateyToolsLocation: 'C:\\tools'}), 'C:\\tools');
        assert.equal(getChocolateyToolsRoot('windows', {}), 'C:\\ProgramData\\chocolatey\\lib');
    });

    it('getHomebrewPrefixes returns no prefixes on Windows', () => {
        assert.deepEqual(getHomebrewPrefixes('windows'), []);
    });

    it('getHomebrewPrefixes covers Apple Silicon + Intel on macOS and Linuxbrew on Linux', () => {
        assert.deepEqual(getHomebrewPrefixes('darwin'), ['/opt/homebrew', '/usr/local']);
        assert.deepEqual(getHomebrewPrefixes('linux'), ['/home/linuxbrew/.linuxbrew']);
    });
});
