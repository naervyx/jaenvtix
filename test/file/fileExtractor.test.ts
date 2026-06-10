import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {findCommonRoot, stripRootFromPath} from '../../src/file/fileExtractor';

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
