import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {fixPath} from '../../src/build/runtimePathFix';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

// Helper: create a fake JDK home by placing a binary under <dir>/bin/<name>.
// Works cross-platform — the file content is irrelevant; existsSync is what matters.
async function mkFakeJdk(dir: string, binaryName = 'javac'): Promise<string> {
    const binDir = join(dir, 'bin');
    await fs.mkdir(binDir, {recursive: true});
    await fs.writeFile(join(binDir, binaryName), '');
    return dir;
}

describe('fixPath', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function tempDir(): Promise<string> {
        const dir = await createTempDir('jaenvtix-fixpath-');
        cleanups.push(() => removeTempDir(dir));
        return dir;
    }

    // --- Linux / generic (javac, no extension) ---

    it('recovers when the user pointed to bin/ instead of the JDK root (Linux)', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);

        const result = fixPath(join(jdkHome, 'bin'), 'linux');

        assert.equal(result, jdkHome);
    });

    it('recovers when the user pointed to bin/javac directly (Linux)', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);

        const result = fixPath(join(jdkHome, 'bin', 'javac'), 'linux');

        assert.equal(result, jdkHome);
    });

    it('returns undefined when the path is more than 2 levels above the JDK root (Linux)', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);

        // 3 levels deep — outside the search bound
        const result = fixPath(join(jdkHome, 'bin', 'javac', 'extra'), 'linux');

        assert.equal(result, undefined);
    });

    it('returns undefined for a completely non-existent path (Linux)', () => {
        const result = fixPath('/nonexistent/path/that/does/not/exist', 'linux');

        assert.equal(result, undefined);
    });

    // --- Windows (javac.exe) ---

    it('recovers when the user pointed to bin/ on Windows (looks for javac.exe)', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome, 'javac.exe');

        const result = fixPath(join(jdkHome, 'bin'), 'win32');

        assert.equal(result, jdkHome);
    });

    it('does not find javac.exe when os=linux (wrong binary name)', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome, 'javac.exe');

        // linux looks for 'javac', not 'javac.exe' — should fail to fix
        const result = fixPath(join(jdkHome, 'bin'), 'linux');

        assert.equal(result, undefined);
    });

    // --- macOS (Contents/Home layout) ---

    it('recovers a macOS .jdk bundle (Contents/Home layout)', async () => {
        const root = await tempDir();
        const bundle = join(root, 'jdk-21.jdk');
        const home = join(bundle, 'Contents', 'Home');
        await mkFakeJdk(home, 'javac');

        const result = fixPath(bundle, 'darwin');

        assert.equal(result, home);
    });

    it('recovers a macOS bundle when the user pointed to Contents/ (Home sub-layout)', async () => {
        const root = await tempDir();
        const bundle = join(root, 'jdk-21.jdk');
        const home = join(bundle, 'Contents', 'Home');
        await mkFakeJdk(home, 'javac');

        // User pointed to Contents/ — fixPath checks <path>/Home = Contents/Home ✓
        const result = fixPath(join(bundle, 'Contents'), 'darwin');

        assert.equal(result, home);
    });

    it('recovers a macOS bundle with a flat Home/ layout (no Contents level)', async () => {
        const root = await tempDir();
        const bundle = join(root, 'custom-jdk');
        const home = join(bundle, 'Home');
        await mkFakeJdk(home, 'javac');

        const result = fixPath(bundle, 'darwin');

        assert.equal(result, home);
    });

    it('does not check Contents/Home on Linux even if the layout matches', async () => {
        const root = await tempDir();
        const bundle = join(root, 'jdk-21.jdk');
        const home = join(bundle, 'Contents', 'Home');
        await mkFakeJdk(home, 'javac');

        // Linux — macOS branches are skipped entirely
        const result = fixPath(bundle, 'linux');

        assert.equal(result, undefined);
    });
});
