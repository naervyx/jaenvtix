import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { setup, suite, teardown, test } from 'mocha';
import { ToolchainManager } from '../services/toolchainManager';

suite('ToolchainManager', () => {
    let tempDir: string;
    let manager: ToolchainManager;
    let filePath: string;

    setup(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jaenvtix-toolchain-'));
        manager = new ToolchainManager(tempDir);
        filePath = path.join(tempDir, 'toolchains.xml');
    });

    teardown(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('creates new toolchains file with entry when none exists', async () => {
        await manager.mergeToolchains(
            [
                {
                    vendor: 'Eclipse Temurin',
                    version: '17',
                    javaHome: '/opt/jdks/temurin-17',
                },
            ],
            filePath,
        );

        const content = await fs.readFile(filePath, 'utf-8');
        assert.match(content, /<vendor>Eclipse Temurin<\/vendor>/);
        assert.match(content, /<version>17<\/version>/);
        assert.match(content, /<jdkHome>\/opt\/jdks\/temurin-17<\/jdkHome>/);
    });

    test('updates existing vendor/version entry while preserving others', async () => {
        const existing = `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <vendor>Eclipse Temurin</vendor>\n      <version>17</version>\n    </provides>\n    <configuration>\n      <jdkHome>/old/path</jdkHome>\n    </configuration>\n  </toolchain>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <vendor>Amazon Corretto</vendor>\n      <version>21</version>\n    </provides>\n    <configuration>\n      <jdkHome>/opt/corretto-21</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`;
        await fs.writeFile(filePath, existing, 'utf-8');

        await manager.mergeToolchains(
            [
                {
                    vendor: 'Eclipse Temurin',
                    version: '17',
                    javaHome: '/new/path',
                },
            ],
            filePath,
        );

        const content = await fs.readFile(filePath, 'utf-8');
        assert.match(content, /<jdkHome>\/new\/path<\/jdkHome>/);
        assert.doesNotMatch(content, /<jdkHome>\/old\/path<\/jdkHome>/);
        assert.match(content, /<vendor>Amazon Corretto<\/vendor>/);
        assert.match(content, /<version>21<\/version>/);
    });
});
