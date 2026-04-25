import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {findProjectsWithFile} from '../../src/file/fileSearch';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

describe('findProjectsWithFile', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function withRoot(): Promise<string> {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        return root;
    }

    it('returns the root when the file lives directly under it', async () => {
        const root = await withRoot();
        await fs.writeFile(join(root, 'pom.xml'), '<project/>');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.deepEqual(projects, [root]);
    });

    it('returns first-level subdirectories that contain the file', async () => {
        const root = await withRoot();
        await fs.mkdir(join(root, 'service-a'));
        await fs.mkdir(join(root, 'service-b'));
        await fs.writeFile(join(root, 'service-a', 'pom.xml'), '<project/>');
        await fs.writeFile(join(root, 'service-b', 'pom.xml'), '<project/>');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.equal(projects.length, 2);
        assert.ok(projects.includes(join(root, 'service-a')));
        assert.ok(projects.includes(join(root, 'service-b')));
    });

    it('returns root + first-level matches together when both apply', async () => {
        const root = await withRoot();
        await fs.writeFile(join(root, 'pom.xml'), '<project/>');
        await fs.mkdir(join(root, 'module'));
        await fs.writeFile(join(root, 'module', 'pom.xml'), '<project/>');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.equal(projects.length, 2);
        assert.ok(projects.includes(root));
        assert.ok(projects.includes(join(root, 'module')));
    });

    it('does NOT recurse beyond the first directory level', async () => {
        const root = await withRoot();
        await fs.mkdir(join(root, 'a', 'b'), {recursive: true});
        await fs.writeFile(join(root, 'a', 'b', 'pom.xml'), '<project/>');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.deepEqual(projects, []);
    });

    it('returns an empty array when no matches exist', async () => {
        const root = await withRoot();
        await fs.mkdir(join(root, 'src'));
        await fs.writeFile(join(root, 'README.md'), '');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.deepEqual(projects, []);
    });

    it('matches by exact filename, not by glob or extension', async () => {
        const root = await withRoot();
        await fs.writeFile(join(root, 'pom.xml.bak'), '');

        const projects = findProjectsWithFile(root, 'pom.xml');
        assert.deepEqual(projects, []);
    });
});
