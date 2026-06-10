import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {extractZip} from '../../../src/file/unpacker/zip';
import {hasJdkInstallation} from '../../../src/build/directory';
import {buildZipBuffer, type ZipFixtureEntry} from '../../fixtures/zip';
import {createTempDir, removeTempDir, writeTempFile} from '../../fixtures/tempDir';

async function extractFixture(entries: ZipFixtureEntry[]): Promise<{dest: string; tempRoot: string}> {
    const tempRoot = await createTempDir();
    const archive = await writeTempFile(tempRoot, 'fixture.zip', buildZipBuffer(entries));
    const dest = join(tempRoot, 'out');
    await fs.mkdir(dest, {recursive: true});
    await extractZip(archive, dest);
    return {dest, tempRoot};
}

describe('extractZip', () => {
    let cleanups: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.map(removeTempDir));
        cleanups = [];
    });

    it('strips the single common root for a Windows JDK zip', async () => {
        const {dest, tempRoot} = await extractFixture([
            {name: 'jdk-21.0.5+11/'},
            {name: 'jdk-21.0.5+11/bin/'},
            {name: 'jdk-21.0.5+11/bin/java.exe', content: 'fake-java-exe'},
            {name: 'jdk-21.0.5+11/release', content: 'JAVA_VERSION="21.0.5"'},
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java.exe')));
        assert.ok(existsSync(join(dest, 'release')));
        assert.ok(!existsSync(join(dest, 'jdk-21.0.5+11')));
        assert.equal(hasJdkInstallation(dest, 'windows'), true);
    });

    it('preserves structure when there is no single common root', async () => {
        const {dest, tempRoot} = await extractFixture([
            {name: 'foo/'},
            {name: 'foo/file', content: 'a'},
            {name: 'bar/'},
            {name: 'bar/file', content: 'b'},
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'foo', 'file')));
        assert.ok(existsSync(join(dest, 'bar', 'file')));
    });

    it('refuses path traversal entries (..)', async () => {
        const {dest, tempRoot} = await extractFixture([
            {name: 'jdk-21/'},
            {name: 'jdk-21/bin/java.exe', content: 'fake'},
            {name: 'jdk-21/../escaped.txt', content: 'should-not-write'},
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java.exe')));
        assert.ok(!existsSync(join(dest, '..', 'escaped.txt')));
        assert.ok(!existsSync(join(dest, 'escaped.txt')));
    });
});
