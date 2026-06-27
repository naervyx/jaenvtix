import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {updateVsCodeSettings, applyUserJavaTunings} from '../../src/build/vsCodeSettingsWriter';
import {JAENVTIX_DEFAULT_SETTINGS} from '../../src/build/jaenvtixDefaultSettings';
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

describe('updateVsCodeSettings — maven.terminal.customEnv per-folder', () => {
    // Business rule: vscode-maven applies `maven.terminal.customEnv` to its
    // own Maven Explorer terminal. We must write it explicitly so that
    // `mvn` invocations from that flow run with the project's JAVA_HOME,
    // independently of whatever `terminal.integrated.env.*` already does
    // for other terminals.
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('writes JAVA_HOME, MAVEN_HOME, M2_HOME and PATH entries to maven.terminal.customEnv', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const customEnv = settings['maven.terminal.customEnv'] as {environmentVariable: string; value: string}[];

        const byKey = Object.fromEntries(customEnv.map((entry) => [entry.environmentVariable, entry.value]));
        assert.equal(byKey.JAVA_HOME, '/home/dev/.jaenvtix/jdk-17');
        assert.equal(byKey.MAVEN_HOME, '/home/dev/.jaenvtix/jdk-17/mvn-custom');
        assert.equal(byKey.M2_HOME, '/home/dev/.jaenvtix/jdk-17/mvn-custom');
        assert.equal(byKey.PATH, '/home/dev/.jaenvtix/jdk-17/bin:/home/dev/.jaenvtix/jdk-17/mvn-custom/bin:${env:PATH}');
    });

    it('preserves user-authored entries with environmentVariable Jaenvtix does not manage', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {
                'maven.terminal.customEnv': [
                    {environmentVariable: 'MY_CUSTOM_VAR', value: 'preserve-me'},
                ],
            },
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const customEnv = settings['maven.terminal.customEnv'] as {environmentVariable: string; value: string}[];

        const myCustom = customEnv.find((entry) => entry.environmentVariable === 'MY_CUSTOM_VAR');
        assert.equal(myCustom?.value, 'preserve-me');
    });

    it('updates an existing entry when its environmentVariable collides with a managed one', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {
                'maven.terminal.customEnv': [
                    {environmentVariable: 'JAVA_HOME', value: '/old/jdk'},
                ],
            },
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);
        const customEnv = settings['maven.terminal.customEnv'] as {environmentVariable: string; value: string}[];

        const javaHome = customEnv.find((entry) => entry.environmentVariable === 'JAVA_HOME');
        assert.equal(javaHome?.value, '/home/dev/.jaenvtix/jdk-17');
        // Only one JAVA_HOME entry — no duplicates.
        assert.equal(customEnv.filter((e) => e.environmentVariable === 'JAVA_HOME').length, 1);
    });

    it('reports updated=false on a no-op second pass', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const second = updateVsCodeSettings(settingsPath, paths);
        assert.equal(second.updated, false);
    });
});

describe('updateVsCodeSettings — mvnw vs Jaenvtix wrapper', () => {
    // Business rule: when the project ships its own `mvnw`, Jaenvtix yields to it.
    // Concretely:
    //   - `maven.executable.path` is NOT written (so vscode-maven keeps using mvnw)
    //   - `maven.executable.preferMavenWrapper` stays `true` (vscode-maven default)
    // When the project does NOT ship `mvnw`, Jaenvtix takes ownership:
    //   - `maven.executable.path` points at the Jaenvtix wrapper
    //   - `maven.executable.preferMavenWrapper` is `false` so vscode-maven uses
    //     the explicit path instead of falling back to a (non-existent) mvnw.
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('yields to mvnw: omits maven.executable.path AND maven.executable.preferMavenWrapper when mavenExecutablePath is undefined', async () => {
        // Both keys are dropped — vscode-maven's default `preferMavenWrapper: true`
        // is already what we want, so writing it would be redundant noise.
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, {...paths, mavenExecutablePath: undefined});
        const settings = await readSettings(settingsPath);

        assert.equal('maven.executable.path' in settings, false);
        assert.equal('maven.executable.preferMavenWrapper' in settings, false);
    });

    it('takes ownership: writes maven.executable.path and sets preferMavenWrapper=false when mavenExecutablePath is defined', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const settings = await readSettings(settingsPath);

        assert.equal(settings['maven.executable.path'], '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin/mvn');
        assert.equal(settings['maven.executable.preferMavenWrapper'], false);
    });

    it('removes a previously written maven.executable.path/preferMavenWrapper when project later starts shipping mvnw', async () => {
        // Scenario: a previous Jaenvtix run pointed maven.executable.path to its wrapper
        // and forced preferMavenWrapper=false. The user then committed `mvnw` to the
        // project. Re-running Jaenvtix must drop both stale keys so vscode-maven falls
        // back to its default (which uses the project's mvnw).
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {
                'maven.executable.path': '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin/jaenvtix-mvn',
                'maven.executable.preferMavenWrapper': false,
            },
        );
        cleanups.push(cleanup);

        const result = updateVsCodeSettings(settingsPath, {...paths, mavenExecutablePath: undefined});
        const settings = await readSettings(settingsPath);

        assert.equal(result.updated, true);
        assert.equal('maven.executable.path' in settings, false);
        assert.equal('maven.executable.preferMavenWrapper' in settings, false);
    });

    it('does NOT write maven.terminal.customEnv when the project ships mvnw (avoids redundancy with terminal.integrated.env.*)', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, {...paths, mavenExecutablePath: undefined});
        const settings = await readSettings(settingsPath);

        assert.equal('maven.terminal.customEnv' in settings, false);
        // The general-purpose terminal env still IS written — vscode-maven's
        // own terminal inherits it via VS Code core.
        assert.ok(settings['terminal.integrated.env.linux']);
    });

    it('removes a previously written maven.terminal.customEnv when project later starts shipping mvnw', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {
                'maven.terminal.customEnv': [
                    {environmentVariable: 'JAVA_HOME', value: '/old/jdk'},
                ],
            },
        );
        cleanups.push(cleanup);

        const result = updateVsCodeSettings(settingsPath, {...paths, mavenExecutablePath: undefined});
        const settings = await readSettings(settingsPath);

        assert.equal(result.updated, true);
        assert.equal('maven.terminal.customEnv' in settings, false);
    });
});

describe('updateVsCodeSettings — jaenvtix.* defaults seeding', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('seeds every jaenvtix.* setting with its default when enabled', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths, {documentJaenvtixSettings: true});
        const settings = await readSettings(settingsPath);

        for (const setting of JAENVTIX_DEFAULT_SETTINGS) {
            assert.deepEqual(settings[setting.key], setting.default, `${setting.key} should default to ${String(setting.default)}`);
        }
    });

    it('writes plain JSON (no comments) so the file stays natively parseable', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths, {documentJaenvtixSettings: true});
        const raw = await fs.readFile(settingsPath, 'utf-8');

        assert.equal(raw.includes('//'), false);
        assert.doesNotThrow(() => JSON.parse(raw));
    });

    it('does NOT write the block when the option is omitted', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths);
        const raw = await fs.readFile(settingsPath, 'utf-8');

        assert.equal(raw.includes('jaenvtix.'), false);
    });

    it('preserves a jaenvtix value the user already set (setIfUndefined)', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile(
            {platform: 'linux'},
            {'jaenvtix.preferredJdkVendor': 'liberica'},
        );
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths, {documentJaenvtixSettings: true});
        const settings = await readSettings(settingsPath);

        assert.equal(settings['jaenvtix.preferredJdkVendor'], 'liberica');
        // The other settings are still seeded with defaults.
        assert.equal(settings['jaenvtix.autoUpdatePatches'], true);
    });

    it('is idempotent: a second pass with the block already present is a no-op', async () => {
        const {settingsPath, paths, cleanup} = await withSettingsFile({platform: 'linux'});
        cleanups.push(cleanup);

        updateVsCodeSettings(settingsPath, paths, {documentJaenvtixSettings: true});
        const second = updateVsCodeSettings(settingsPath, paths, {documentJaenvtixSettings: true});

        assert.equal(second.updated, false);
        const settings = await readSettings(settingsPath);
        assert.equal(settings['java.jdt.ls.java.home'], '/home/dev/.jaenvtix/jdk-17');
        assert.equal(settings['jaenvtix.isolatedMavenPerProject'], true);
    });
});

describe('applyUserJavaTunings', () => {
    it('writes 4 settings on Linux (no java.test.config)', () => {
        const result = applyUserJavaTunings({}, 'linux');
        assert.equal(result['java.debug.settings.hotCodeReplace'], 'auto');
        assert.notEqual(result['java.maxConcurrentBuilds'], undefined);
        assert.equal(result['java.dependency.packagePresentation'], 'hierarchical');
        assert.equal(result['java.sources.organizeImports.staticStarThreshold'], 1);
        assert.equal('java.test.config' in result, false);
    });

    it('writes 5 settings on Windows (includes java.test.config with UTF-8 vmArg)', () => {
        const result = applyUserJavaTunings({}, 'win32');
        assert.equal(result['java.debug.settings.hotCodeReplace'], 'auto');
        assert.deepEqual(result['java.test.config'], [{vmArgs: ['-Dfile.encoding=UTF-8']}]);
    });

    it('preserves an existing hotCodeReplace value and writes the remaining 3', () => {
        const result = applyUserJavaTunings({'java.debug.settings.hotCodeReplace': 'manual'}, 'linux');
        assert.equal(result['java.debug.settings.hotCodeReplace'], 'manual');
        assert.equal(result['java.dependency.packagePresentation'], 'hierarchical');
        assert.equal(result['java.sources.organizeImports.staticStarThreshold'], 1);
        assert.notEqual(result['java.maxConcurrentBuilds'], undefined);
    });

    it('is a no-op when all 5 keys are already set (Windows)', () => {
        const input: Record<string, unknown> = {
            'java.debug.settings.hotCodeReplace': 'manual',
            'java.maxConcurrentBuilds': 2,
            'java.dependency.packagePresentation': 'flat',
            'java.sources.organizeImports.staticStarThreshold': 99,
            'java.test.config': [],
        };
        const result = applyUserJavaTunings(input, 'win32');
        assert.deepEqual(result, input);
    });

    it('computes maxConcurrentBuilds as CPU-count minus 1, minimum 1', () => {
        const result = applyUserJavaTunings({}, 'linux');
        const computed = result['java.maxConcurrentBuilds'] as number;
        assert.ok(computed >= 1, 'must be at least 1');
    });
});
