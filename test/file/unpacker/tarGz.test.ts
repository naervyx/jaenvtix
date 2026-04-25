import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';

import { extractTarGz } from '../../../src/file/unpacker/tarGz';
import { hasJdkInstallation } from '../../../src/build/directory';
import { buildTarGzBuffer, type TarFixtureEntry } from '../../fixtures/tar';
import { createTempDir, removeTempDir, writeTempFile } from '../../fixtures/tempDir';

const isWindows = process.platform === 'win32';

async function extractFixture(entries: TarFixtureEntry[]): Promise<{ dest: string; tempRoot: string }> {
    const tempRoot = await createTempDir();
    const archive = await writeTempFile(tempRoot, 'fixture.tar.gz', buildTarGzBuffer(entries));
    const dest = join(tempRoot, 'out');
    await fs.mkdir(dest, { recursive: true });
    await extractTarGz(archive, dest);
    return { dest, tempRoot };
}

describe('extractTarGz', () => {
    let cleanups: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.map(removeTempDir));
        cleanups = [];
    });

    it('strips the single common root for a Temurin/Adoptium-style archive', async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: 'jdk-17.0.10+7/', type: 'dir' },
            { name: 'jdk-17.0.10+7/bin/', type: 'dir' },
            { name: 'jdk-17.0.10+7/bin/java', type: 'file', content: 'fake-java-binary', mode: 0o755 },
            { name: 'jdk-17.0.10+7/release', type: 'file', content: 'JAVA_VERSION="17.0.10"' },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java')), 'bin/java must exist directly under dest');
        assert.ok(existsSync(join(dest, 'release')), 'release must exist directly under dest');
        assert.ok(!existsSync(join(dest, 'jdk-17.0.10+7')), 'archive root must be stripped');
        assert.equal(hasJdkInstallation(dest, 'linux'), true);
    });

    it('strips the root for an Amazon Corretto archive prefixed with a PAX global header', async () => {
        // Reproduces the exact failure mode reported for Corretto JDK 11/17 on
        // Linux/macOS: a `pax_global_header` (type 'g') precedes the real tree.
        const { dest, tempRoot } = await extractFixture([
            { name: 'pax_global_header', type: 'pax-global', content: '52 comment=corretto\n' },
            { name: 'amazon-corretto-11.0.31.11.1-linux-x64/', type: 'dir' },
            { name: 'amazon-corretto-11.0.31.11.1-linux-x64/bin/', type: 'dir' },
            { name: 'amazon-corretto-11.0.31.11.1-linux-x64/bin/java', type: 'file', content: 'fake', mode: 0o755 },
            { name: 'amazon-corretto-11.0.31.11.1-linux-x64/release', type: 'file', content: 'JAVA_VERSION="11.0.31"' },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java')), 'bin/java must exist directly under dest');
        assert.ok(!existsSync(join(dest, 'amazon-corretto-11.0.31.11.1-linux-x64')), 'Corretto root must be stripped');
        assert.equal(hasJdkInstallation(dest, 'linux'), true);
    });

    it('ignores PAX extended (per-entry) headers when computing the common root', async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: 'PaxHeaders/jdk-21/bin/java', type: 'pax-extended', content: '30 atime=1700000000\n' },
            { name: 'jdk-21/', type: 'dir' },
            { name: 'jdk-21/bin/', type: 'dir' },
            { name: 'jdk-21/bin/java', type: 'file', content: 'fake', mode: 0o755 },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java')));
        assert.ok(!existsSync(join(dest, 'jdk-21')));
    });

    it('ignores GNU LongLink/LongName metadata records', async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: '././@LongLink', type: 'gnu-longname', content: 'jdk-17/bin/java\0' },
            { name: 'jdk-17/', type: 'dir' },
            { name: 'jdk-17/bin/', type: 'dir' },
            { name: 'jdk-17/bin/java', type: 'file', content: 'fake', mode: 0o755 },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java')));
    });

    it('preserves the structure when the archive has no single common root', async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: 'jdk-a/', type: 'dir' },
            { name: 'jdk-a/file', type: 'file', content: 'a' },
            { name: 'jdk-b/', type: 'dir' },
            { name: 'jdk-b/file', type: 'file', content: 'b' },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'jdk-a', 'file')));
        assert.ok(existsSync(join(dest, 'jdk-b', 'file')));
    });

    it('writes file content faithfully', async () => {
        const payload = 'hello-world-' + 'x'.repeat(2000);
        const { dest, tempRoot } = await extractFixture([
            { name: 'jdk-17/', type: 'dir' },
            { name: 'jdk-17/data.txt', type: 'file', content: payload },
        ]);
        cleanups.push(tempRoot);

        const written = await fs.readFile(join(dest, 'data.txt'), 'utf8');
        assert.equal(written, payload);
    });

    it('refuses path traversal entries (..)', async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: 'jdk-17/', type: 'dir' },
            { name: 'jdk-17/bin/java', type: 'file', content: 'fake' },
            { name: 'jdk-17/../escaped.txt', type: 'file', content: 'should-not-write' },
        ]);
        cleanups.push(tempRoot);

        assert.ok(existsSync(join(dest, 'bin', 'java')));
        assert.ok(!existsSync(join(dest, '..', 'escaped.txt')));
        assert.ok(!existsSync(join(dest, 'escaped.txt')));
    });

    it('applies executable bits on POSIX platforms', { skip: isWindows }, async () => {
        const { dest, tempRoot } = await extractFixture([
            { name: 'jdk-17/', type: 'dir' },
            { name: 'jdk-17/bin/', type: 'dir' },
            { name: 'jdk-17/bin/java', type: 'file', content: 'fake', mode: 0o755 },
        ]);
        cleanups.push(tempRoot);

        const stat = await fs.stat(join(dest, 'bin', 'java'));
        assert.equal((stat.mode & 0o777), 0o755);
    });
});
