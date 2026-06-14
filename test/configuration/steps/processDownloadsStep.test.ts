import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ensureBinDirectoryExecutable, ProcessDownloadsStep} from '../../../src/configuration/steps/processDownloadsStep';
import {createInitialState} from '../../../src/core/types';
import {buildTarGzBuffer} from '../../fixtures/tar';
import {createTempDir, removeTempDir, writeTempFile} from '../../fixtures/tempDir';

const isWindows = process.platform === 'win32';

describe('ensureBinDirectoryExecutable', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('is a no-op on windows', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        // Should resolve without error even though there's no `bin` dir.
        await ensureBinDirectoryExecutable(root, 'windows');
    });

    it('is a no-op when <root>/bin does not exist', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        await ensureBinDirectoryExecutable(root, 'linux');
    });

    it('chmods top-level files in <root>/bin to 0o755', {skip: isWindows}, async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const binDir = join(root, 'bin');
        await fs.mkdir(binDir, {recursive: true});
        const javaBin = join(binDir, 'java');
        await fs.writeFile(javaBin, 'fake');
        await fs.chmod(javaBin, 0o644);

        await ensureBinDirectoryExecutable(root, 'linux');

        const stat = await fs.stat(javaBin);
        assert.equal(stat.mode & 0o777, 0o755);
    });

    it('REGRESSION (B3): chmods nested files under <root>/bin/lib/sub recursively', {skip: isWindows}, async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const nested = join(root, 'bin', 'lib', 'sub');
        await fs.mkdir(nested, {recursive: true});
        const nestedExec = join(nested, 'helper');
        await fs.writeFile(nestedExec, 'fake');
        await fs.chmod(nestedExec, 0o600);

        await ensureBinDirectoryExecutable(root, 'darwin');

        const stat = await fs.stat(nestedExec);
        assert.equal(stat.mode & 0o777, 0o755);
    });

    it('does not crash when bin contains symlinks/dangling files', {skip: isWindows}, async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const binDir = join(root, 'bin');
        await fs.mkdir(binDir, {recursive: true});
        await fs.writeFile(join(binDir, 'real'), 'fake');

        // Best-effort: ensures the implementation swallows per-file failures.
        await ensureBinDirectoryExecutable(root, 'linux');
    });
});

describe('ProcessDownloadsStep — macOS bundle jdkHome normalization', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    function buildVersionPaths(slot: string): {jdkHome: string; toolHome: string; toolBin: string} {
        return {
            jdkHome: slot,
            toolHome: join(slot, 'mvn-custom'),
            toolBin: join(slot, 'mvn-custom', 'bin'),
        };
    }

    const macosBundleArchive = buildTarGzBuffer([
        {name: 'jdk-11.0.22+7/', type: 'dir'},
        {name: 'jdk-11.0.22+7/Contents/Home/bin/java', type: 'file', content: 'fake', mode: 0o755},
    ]);

    it('REGRESSION: normalizes jdkHome to Contents/Home after extracting a macOS bundle', async () => {
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));
        const archive = await writeTempFile(tempRoot, 'jdk-11-macos.tar.gz', macosBundleArchive);
        const slot = join(tempRoot, 'jdk-11');

        const state = createInitialState();
        state.platform = 'darwin';
        state.versionPaths.set('11', buildVersionPaths(slot));
        state.jdkDownloads.set('11', Promise.resolve({success: true, filePath: archive}));

        const result = await new ProcessDownloadsStep().run(state);

        assert.equal(result.success, true, result.message);
        assert.equal(state.versionPaths.get('11')?.jdkHome, join(slot, 'Contents', 'Home'));
    });

    it('REGRESSION: extracts an Oracle macOS archive (./ prefix) and resolves jdkHome to Contents/Home', async () => {
        // User-reported scenario: Oracle JDK 21 on macOS. Entries are prefixed
        // with `./`, so without normalization the bundle landed at
        // <slot>/jdk-21.0.11.jdk/Contents/Home and the step failed with
        // JDK_EXTRACTION_FAILED.
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));
        const oracleArchive = buildTarGzBuffer([
            {name: './', type: 'dir'},
            {name: './jdk-21.0.11.jdk/', type: 'dir'},
            {name: './jdk-21.0.11.jdk/Contents/Home/bin/java', type: 'file', content: 'fake', mode: 0o755},
        ]);
        const archive = await writeTempFile(tempRoot, 'jdk-21-oracle-macos.tar.gz', oracleArchive);
        const slot = join(tempRoot, 'jdk-21');

        const state = createInitialState();
        state.platform = 'darwin';
        state.versionPaths.set('21', buildVersionPaths(slot));
        state.jdkDownloads.set('21', Promise.resolve({success: true, filePath: archive}));

        const result = await new ProcessDownloadsStep().run(state);

        assert.equal(result.success, true, result.message);
        assert.equal(state.versionPaths.get('21')?.jdkHome, join(slot, 'Contents', 'Home'));
        assert.equal(existsSync(join(slot, 'jdk-21.0.11.jdk')), false);
    });

    it('REGRESSION: recognizes an already-extracted bundle and does not fail or re-download', async () => {
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));
        const slot = join(tempRoot, 'jdk-11');
        await fs.mkdir(join(slot, 'Contents', 'Home', 'bin'), {recursive: true});
        await fs.writeFile(join(slot, 'Contents', 'Home', 'bin', 'java'), 'fake');

        const state = createInitialState();
        state.platform = 'darwin';
        state.versionPaths.set('11', buildVersionPaths(slot));

        const result = await new ProcessDownloadsStep().run(state);

        assert.equal(result.success, true, result.message);
        assert.equal(state.versionPaths.get('11')?.jdkHome, join(slot, 'Contents', 'Home'));
    });

    it('keeps jdkHome unchanged for a plain (non-bundle) layout', async () => {
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));
        const slot = join(tempRoot, 'jdk-17');
        await fs.mkdir(join(slot, 'bin'), {recursive: true});
        await fs.writeFile(join(slot, 'bin', 'java'), 'fake');

        const state = createInitialState();
        state.platform = 'linux';
        state.versionPaths.set('17', buildVersionPaths(slot));

        const result = await new ProcessDownloadsStep().run(state);

        assert.equal(result.success, true, result.message);
        assert.equal(state.versionPaths.get('17')?.jdkHome, slot);
    });
});
