import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {findCommonRoot, stripRootFromPath, writeFileWithDirectory} from '../../src/file/fileExtractor';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

describe('findCommonRoot', () => {
    it('returns the shared top-level directory when every entry is nested under it', () => {
        const root = findCommonRoot([
            'jdk-17/',
            'jdk-17/bin/',
            'jdk-17/bin/java',
            'jdk-17/release',
        ]);
        assert.equal(root, 'jdk-17/');
    });

    it('returns null when entries have multiple top-level segments', () => {
        const root = findCommonRoot([
            'jdk-a/file',
            'jdk-b/file',
        ]);
        assert.equal(root, null);
    });

    it('returns null when some entries are flat files alongside a directory tree', () => {
        const root = findCommonRoot([
            'jdk-17/bin/java',
            'README',
        ]);
        assert.equal(root, null);
    });

    it('returns null for an empty list', () => {
        assert.equal(findCommonRoot([]), null);
    });

    it('treats backslashes as path separators (Windows-friendly tarballs)', () => {
        const root = findCommonRoot([
            'jdk-21\\bin\\java.exe',
            'jdk-21\\release',
        ]);
        assert.equal(root, 'jdk-21/');
    });
});

describe('stripRootFromPath', () => {
    it('removes the prefix when present', () => {
        assert.equal(stripRootFromPath('jdk-17/bin/java', 'jdk-17/'), 'bin/java');
    });

    it('leaves the path unchanged when root is null', () => {
        assert.equal(stripRootFromPath('amazon-corretto-11/bin/java', null), 'amazon-corretto-11/bin/java');
    });

    it('leaves the path unchanged when the prefix does not match', () => {
        assert.equal(stripRootFromPath('jdk-21/bin/java', 'jdk-17/'), 'jdk-21/bin/java');
    });
});

describe('writeFileWithDirectory', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('creates missing ancestor directories before writing', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const target = join(root, 'a', 'b', 'file.txt');

        await writeFileWithDirectory(target, Buffer.from('content'));

        assert.equal(await fs.readFile(target, 'utf8'), 'content');
    });

    it('REGRESSION: overwrites a read-only file left by a previous extraction', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const target = join(root, 'legal', 'dynalink.md');
        await writeFileWithDirectory(target, Buffer.from('first extraction'));
        // JDK archives ship legal/** with mode 0444; the POSIX extractor
        // preserves it. EACCES (POSIX) / EPERM (Windows readonly attribute)
        // on overwrite is the production failure being guarded here.
        await fs.chmod(target, 0o444);

        await writeFileWithDirectory(target, Buffer.from('second extraction'));

        assert.equal(await fs.readFile(target, 'utf8'), 'second extraction');
    });
});
