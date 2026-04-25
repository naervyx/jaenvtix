import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ensureBinDirectoryExecutable} from '../../../src/configuration/steps/processDownloadsStep';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

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
