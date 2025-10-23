import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { setup, suite, teardown, test } from 'mocha';
import { WorkspaceConfigurator } from '../services/workspaceConfigurator';

suite('WorkspaceConfigurator', () => {
    let tempDir: string;
    let configurator: WorkspaceConfigurator;

    setup(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jaenvtix-workspace-'));
        configurator = new WorkspaceConfigurator();
    });

    teardown(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function readSettings(workspaceRoot: string): Promise<Record<string, unknown>> {
        const filePath = path.join(workspaceRoot, '.vscode', 'settings.json');
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    }

    test('writes fallback maven executable and jaenvtix metadata', async () => {
        const fallback = path.join(tempDir, 'bin', 'mvn-jaenvtix');
        await configurator.apply({
            workspaceRoot: tempDir,
            javaHome: '/opt/jdk-21',
            release: '21',
            vendor: 'Oracle JDK',
            mavenExecutable: fallback,
            toolchainsPath: '/home/user/.m2/toolchains.xml',
        });

        const settings = await readSettings(tempDir);
        assert.strictEqual(settings['maven.executable.path'], fallback);
        assert.strictEqual(settings['maven.terminal.useJavaHome'], true);
        assert.strictEqual(settings['jaenvtix.javaHome'], '/opt/jdk-21');
        assert.strictEqual(settings['jaenvtix.release'], '21');
        assert.strictEqual(settings['jaenvtix.vendor'], 'Oracle JDK');
        assert.strictEqual(settings['jaenvtix.mavenExecutable'], fallback);
        assert.strictEqual(settings['jaenvtix.toolchainsPath'], '/home/user/.m2/toolchains.xml');
    });

    test('prefers mvnw wrapper when present', async () => {
        const wrapperPath = path.join(tempDir, 'mvnw');
        await fs.writeFile(wrapperPath, '#!/bin/bash\n', { mode: 0o755 });
        const fallback = path.join(tempDir, 'bin', 'mvn-jaenvtix');

        await configurator.apply({
            workspaceRoot: tempDir,
            javaHome: '/opt/jdk-17',
            release: '17',
            vendor: 'Eclipse Temurin',
            mavenExecutable: fallback,
            toolchainsPath: '/custom/toolchains.xml',
        });

        const settings = await readSettings(tempDir);
        assert.strictEqual(settings['maven.executable.path'], wrapperPath);
        assert.strictEqual(settings['jaenvtix.mavenExecutable'], wrapperPath);
    });

    test('merges with existing settings.json content', async () => {
        const settingsPath = path.join(tempDir, '.vscode', 'settings.json');
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify({ 'editor.formatOnSave': true }, null, 4));

        const fallback = path.join(tempDir, 'bin', 'mvn-jaenvtix');
        await configurator.apply({
            workspaceRoot: tempDir,
            javaHome: '/opt/jdk-11',
            release: '11',
            vendor: 'Amazon Corretto',
            mavenExecutable: fallback,
            toolchainsPath: '/other/toolchains.xml',
        });

        const settings = await readSettings(tempDir);
        assert.strictEqual(settings['editor.formatOnSave'], true);
        assert.strictEqual(settings['jaenvtix.release'], '11');
    });

    test('handles existing JSONC content without wiping user settings', async () => {
        const settingsPath = path.join(tempDir, '.vscode', 'settings.json');
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        const jsonc = `{
    // Preserve format on save
    "editor.formatOnSave": true,
}`;
        await fs.writeFile(settingsPath, jsonc);

        const fallback = path.join(tempDir, 'bin', 'mvn-jaenvtix');
        await configurator.apply({
            workspaceRoot: tempDir,
            javaHome: '/opt/jdk-11',
            release: '11',
            vendor: 'Amazon Corretto',
            mavenExecutable: fallback,
            toolchainsPath: '/other/toolchains.xml',
        });

        const settings = await readSettings(tempDir);
        assert.strictEqual(settings['editor.formatOnSave'], true);
        assert.strictEqual(settings['jaenvtix.toolchainsPath'], '/other/toolchains.xml');
    });

    test('preserves invalid settings.json content by leaving the file untouched', async () => {
        const settingsPath = path.join(tempDir, '.vscode', 'settings.json');
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        const invalidContent = '{"editor.formatOnSave": true,';
        await fs.writeFile(settingsPath, invalidContent);

        const fallback = path.join(tempDir, 'bin', 'mvn-jaenvtix');
        await configurator.apply({
            workspaceRoot: tempDir,
            javaHome: '/opt/jdk-11',
            release: '11',
            vendor: 'Amazon Corretto',
            mavenExecutable: fallback,
            toolchainsPath: '/other/toolchains.xml',
        });

        const raw = await fs.readFile(settingsPath, 'utf-8');
        assert.strictEqual(raw, invalidContent);
    });
});
