import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {mergeUserRuntimes, validateAndCleanRuntimes, JavaRuntime} from '../../src/build/userRuntimesMerge';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

// Business rule: Jaenvtix populates the user's `java.configuration.runtimes`
// cooperatively. The Red Hat Language Server reads this array to resolve which
// JDK to use per Maven project. Whatever the user already mapped is sacred —
// Jaenvtix only ADDS missing entries and never overwrites existing ones.

describe('mergeUserRuntimes', () => {
    it('preserves the user mapping when an entry with the same name already exists', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/own/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].path, '/user/own/jdk-17');
    });

    it('does not duplicate when an existing entry already points to the candidate path (regardless of name)', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'Java-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].name, 'JavaSE-21');
    });

    it('appends candidates that share neither name nor path with any existing entry', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/own/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
            {name: 'JavaSE-11', path: '/.jaenvtix/jdk-11'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, true);
        assert.equal(merged.length, 3);
        assert.deepEqual(
            merged.map((r) => r.name).sort(),
            ['JavaSE-11', 'JavaSE-17', 'JavaSE-21'],
        );
    });

    it("preserves existing entries' default flag without copying it to new entries", () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17', default: true},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged} = mergeUserRuntimes(existing, candidates);

        const existingEntry = merged.find((r) => r.name === 'JavaSE-17');
        const newEntry = merged.find((r) => r.name === 'JavaSE-21');
        assert.equal(existingEntry?.default, true);
        assert.equal(newEntry?.default, undefined);
    });

    it('preserves sources/javadoc fields the user had configured on existing entries', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17', sources: '/user/src', javadoc: '/user/doc'},
        ];
        const candidates: JavaRuntime[] = [];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged[0].sources, '/user/src');
        assert.equal(merged[0].javadoc, '/user/doc');
    });

    it('reports updated=false (no-op) when every candidate is already covered', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 2);
    });

    it('does not mutate the input arrays', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        mergeUserRuntimes(existing, candidates);

        assert.equal(existing.length, 1);
        assert.equal(candidates.length, 1);
    });
});

// ---------------------------------------------------------------------------
// validateAndCleanRuntimes — validate + optionally fix existing runtimes
// ---------------------------------------------------------------------------

// Helper: create a fake JDK home under dir with a bin/javac file.
async function mkFakeJdk(dir: string): Promise<string> {
    await fs.mkdir(join(dir, 'bin'), {recursive: true});
    await fs.writeFile(join(dir, 'bin', 'javac'), '');
    return dir;
}

describe('validateAndCleanRuntimes', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function tempDir(): Promise<string> {
        const dir = await createTempDir('jaenvtix-clean-');
        cleanups.push(() => removeTempDir(dir));
        return dir;
    }

    it('keeps a valid entry as-is', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);
        const entry: JavaRuntime = {name: 'JavaSE-17', path: jdkHome, default: true};

        const {kept, fixed, removed} = validateAndCleanRuntimes([entry], true, 'linux');

        assert.equal(kept.length, 1);
        assert.equal(kept[0].path, jdkHome);
        assert.equal(kept[0].default, true);
        assert.equal(fixed.length, 0);
        assert.equal(removed.length, 0);
    });

    it('fixes an entry pointing to bin/ when enableFix is true', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);
        const entry: JavaRuntime = {name: 'JavaSE-17', path: join(jdkHome, 'bin')};

        const {kept, fixed, removed} = validateAndCleanRuntimes([entry], true, 'linux');

        assert.equal(kept.length, 1);
        assert.equal(kept[0].path, jdkHome);
        assert.equal(kept[0].name, 'JavaSE-17');
        assert.equal(fixed.length, 1);
        assert.equal(fixed[0].oldPath, join(jdkHome, 'bin'));
        assert.equal(fixed[0].entry.path, jdkHome);
        assert.equal(removed.length, 0);
    });

    it('removes an entry pointing to bin/ when enableFix is false', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);
        const entry: JavaRuntime = {name: 'JavaSE-17', path: join(jdkHome, 'bin')};

        const {kept, fixed, removed} = validateAndCleanRuntimes([entry], false, 'linux');

        assert.equal(kept.length, 0);
        assert.equal(fixed.length, 0);
        assert.equal(removed.length, 1);
        assert.equal(removed[0].name, 'JavaSE-17');
    });

    it('removes an entry with a completely non-existent path', () => {
        const entry: JavaRuntime = {name: 'JavaSE-21', path: '/does/not/exist/anywhere'};

        const {kept, fixed, removed} = validateAndCleanRuntimes([entry], true, 'linux');

        assert.equal(kept.length, 0);
        assert.equal(fixed.length, 0);
        assert.equal(removed.length, 1);
    });

    it('preserves name, default, sources and javadoc when fixing an entry', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);
        const entry: JavaRuntime = {
            name: 'JavaSE-17',
            path: join(jdkHome, 'bin'),
            default: true,
            sources: '/src',
            javadoc: '/doc',
        };

        const {kept} = validateAndCleanRuntimes([entry], true, 'linux');

        assert.equal(kept[0].name, 'JavaSE-17');
        assert.equal(kept[0].default, true);
        assert.equal(kept[0].sources, '/src');
        assert.equal(kept[0].javadoc, '/doc');
    });

    it('handles a mix of valid, fixable, and irrecoverable entries', async () => {
        const root = await tempDir();

        const validHome = join(root, 'jdk-21');
        await mkFakeJdk(validHome);

        const fixableHome = join(root, 'jdk-17');
        await mkFakeJdk(fixableHome);

        const entries: JavaRuntime[] = [
            {name: 'JavaSE-21', path: validHome},
            {name: 'JavaSE-17', path: join(fixableHome, 'bin')},
            {name: 'JavaSE-11', path: '/nonexistent'},
        ];

        const {kept, fixed, removed} = validateAndCleanRuntimes(entries, true, 'linux');

        assert.equal(kept.length, 2);
        assert.equal(fixed.length, 1);
        assert.equal(removed.length, 1);
        assert.equal(removed[0].name, 'JavaSE-11');
    });

    it('returns empty results for an empty input array', () => {
        const {kept, fixed, removed} = validateAndCleanRuntimes([], true, 'linux');

        assert.equal(kept.length, 0);
        assert.equal(fixed.length, 0);
        assert.equal(removed.length, 0);
    });

    it('does not mutate the input array', async () => {
        const root = await tempDir();
        const jdkHome = join(root, 'jdk-17');
        await mkFakeJdk(jdkHome);
        const entry: JavaRuntime = {name: 'JavaSE-17', path: join(jdkHome, 'bin')};
        const existing = [entry];

        validateAndCleanRuntimes(existing, true, 'linux');

        assert.equal(existing.length, 1);
        assert.equal(existing[0].path, join(jdkHome, 'bin'));
    });
});
