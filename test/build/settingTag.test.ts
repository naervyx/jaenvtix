import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {updateVsCodeSettings} from '../../src/build/settingTag';
import type {PlatformType} from '../../src/core/system';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

interface ScenarioOverrides {
    platform?: PlatformType;
    javaHomePath?: string;
    runtimes?: {name: string; path: string; default?: boolean}[];
}

async function withSettingsFile(
    overrides: ScenarioOverrides,
    initial?: Record<string, unknown>,
): Promise<{settingsPath: string; paths: Parameters<typeof updateVsCodeSettings>[1]; cleanup: () => Promise<void>}> {
    const tempRoot = await createTempDir();
    const settingsPath = join(tempRoot, '.vscode', 'settings.json');
    if (initial) {
        await fs.mkdir(join(tempRoot, '.vscode'), {recursive: true});
        writeFileSync(settingsPath, JSON.stringify(initial), 'utf-8');
    }

    const paths = {
        javaHomePath: overrides.javaHomePath ?? '/home/dev/.jaenvtix/jdk-17',
        runtimes: overrides.runtimes,
        terminalJavaHome: overrides.javaHomePath ?? '/home/dev/.jaenvtix/jdk-17',
        mavenHomePath: '/home/dev/.jaenvtix/jdk-17/mvn-custom',
        mavenBinPath: '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin',
        mavenExecutablePath: '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin/mvn',
        userSettingsPath: '/home/dev/.m2/settings.xml',
        platform: overrides.platform ?? 'linux',
    };

    return {settingsPath, paths, cleanup: () => removeTempDir(tempRoot)};
}

async function readSettings(settingsPath: string): Promise<Record<string, unknown>> {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
}

describe('updateVsCodeSettings — required keys', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('writes the canonical jdt.ls / maven / null-analysis keys on a fresh project', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        const result = updateVsCodeSettings(settingsPath, paths);
        assert.equal(result.updated, true);

        const settings = await readSettings(settingsPath);
        assert.equal(settings['java.jdt.ls.java.home'], '/home/dev/.jaenvtix/jdk-17');
        assert.equal(settings['java.jdt.ls.lombokSupport.enabled'], true);
        assert.equal(settings['maven.executable.preferMavenWrapper'], false);
        assert.equal(settings['maven.executable.path'], '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin/mvn');
        assert.equal(settings['java.compile.nullAnalysis.mode'], 'automatic');
        assert.equal(settings['java.configuration.updateBuildConfiguration'], 'automatic');
        assert.equal(settings['java.configuration.maven.userSettings'], '/home/dev/.m2/settings.xml');
    });

    it('omits jdt.ls.java.home when no JDK is provided (Java 21+ uses bundled JDK)', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux', javaHomePath: undefined});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, {...paths, javaHomePath: undefined});
        const settings = await readSettings(settingsPath);
        assert.equal('java.jdt.ls.java.home' in settings, false);
    });

    it('reports updated=false on a no-op second pass', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const second = updateVsCodeSettings(settingsPath, paths);
        assert.equal(second.updated, false);
    });

    it('preserves unrelated keys already in settings.json', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {'editor.fontSize': 14, 'workbench.colorTheme': 'Default Dark+'},
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        assert.equal(settings['editor.fontSize'], 14);
        assert.equal(settings['workbench.colorTheme'], 'Default Dark+');
    });

    it('rewrites cleanly when the existing settings.json is malformed JSON', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);
        await fs.mkdir(join(settingsPath, '..'), {recursive: true});
        writeFileSync(settingsPath, '{not valid json', 'utf-8');

        const result = updateVsCodeSettings(settingsPath, paths);
        assert.equal(result.updated, true);
        const settings = await readSettings(settingsPath);
        assert.equal(settings['java.jdt.ls.java.home'], '/home/dev/.jaenvtix/jdk-17');
    });
});

describe('updateVsCodeSettings — runtimes gating', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('writes the runtimes array when any project needs Java < 21', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({
            platform: 'linux',
            runtimes: [{name: 'JavaSE-17', path: '/jdk-17', default: true}],
        });
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        assert.deepEqual(settings['java.configuration.runtimes'], [
            {name: 'JavaSE-17', path: '/jdk-17', default: true},
        ]);
    });

    it('removes a previously written runtimes array when no runtimes are required', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {'java.configuration.runtimes': [{name: 'JavaSE-11', path: '/jdk-11'}]},
        );
        cleanups.push(cleanup);

        const result = updateVsCodeSettings(settingsPath, paths);
        assert.equal(result.updated, true);
        const settings = await readSettings(settingsPath);
        assert.equal('java.configuration.runtimes' in settings, false);
    });
});

describe('updateVsCodeSettings — terminal.integrated.env per platform', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('writes terminal.integrated.env.linux on linux with PATH and : delimiter', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const env = settings['terminal.integrated.env.linux'] as Record<string, string>;

        assert.equal(env.JAVA_HOME, '/home/dev/.jaenvtix/jdk-17');
        assert.equal(env.MAVEN_HOME, '/home/dev/.jaenvtix/jdk-17/mvn-custom');
        assert.equal(env.M2_HOME, '/home/dev/.jaenvtix/jdk-17/mvn-custom');
        assert.equal(env.PATH, '/home/dev/.jaenvtix/jdk-17/bin:/home/dev/.jaenvtix/jdk-17/mvn-custom/bin:${env:PATH}');
    });

    it('writes terminal.integrated.env.osx on darwin (not .mac, not .darwin)', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'darwin'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        assert.equal('terminal.integrated.env.osx' in settings, true);
        assert.equal('terminal.integrated.env.darwin' in settings, false);
    });

    it('writes terminal.integrated.env.windows with ; delimiter and Path (capitalized) for fresh installs', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({
            platform: 'windows',
            javaHomePath: 'C:\\Users\\dev\\.jaenvtix\\jdk-17',
        });
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, {
            ...paths,
            mavenHomePath: 'C:\\Users\\dev\\.jaenvtix\\jdk-17\\mvn-custom',
            mavenBinPath: 'C:\\Users\\dev\\.jaenvtix\\jdk-17\\mvn-custom\\bin',
            mavenExecutablePath: 'C:\\Users\\dev\\.jaenvtix\\jdk-17\\mvn-custom\\bin\\mvn.cmd',
        });
        const settings = await readSettings(settingsPath);
        const env = settings['terminal.integrated.env.windows'] as Record<string, string>;
        assert.equal(env.Path, 'C:\\Users\\dev\\.jaenvtix\\jdk-17\\bin;C:\\Users\\dev\\.jaenvtix\\jdk-17\\mvn-custom\\bin;${env:Path}');
        assert.equal('PATH' in env, false);
    });

    it('preserves an existing PATH (uppercase) variable on windows instead of forking into Path', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'windows'},
            {'terminal.integrated.env.windows': {PATH: 'preexisting'}},
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const env = settings['terminal.integrated.env.windows'] as Record<string, string>;
        assert.equal('PATH' in env, true);
        assert.equal('Path' in env, false);
    });

    it('merges with existing terminal env, leaving unrelated keys untouched', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {'terminal.integrated.env.linux': {EXISTING_VAR: 'value', JAVA_HOME: '/old-jdk'}},
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const env = settings['terminal.integrated.env.linux'] as Record<string, string>;
        assert.equal(env.EXISTING_VAR, 'value');
        assert.equal(env.JAVA_HOME, '/home/dev/.jaenvtix/jdk-17');
    });
});
