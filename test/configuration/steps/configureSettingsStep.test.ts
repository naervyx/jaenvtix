import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ConfigureSettingsStep} from '../../../src/configuration/steps/configureSettingsStep';
import {createInitialState} from '../../../src/core/types';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

describe('ConfigureSettingsStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function projectDir(): Promise<string> {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        return root;
    }

    it('writes settings.json with java.jdt.ls.java.home for Java >= 21 (no runtimes array)', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '21',
            jdkHome: '/home/dev/.jaenvtix/jdk-21',
            toolHome: '/home/dev/.jaenvtix/jdk-21/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-21/mvn-custom/bin',
            hasMvnw: false,
        }];

        const result = await new ConfigureSettingsStep().run(state);
        assert.equal(result.success, true);

        const settingsPath = join(project, '.vscode', 'settings.json');
        assert.ok(existsSync(settingsPath));
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        assert.equal(settings['java.jdt.ls.java.home'], '/home/dev/.jaenvtix/jdk-21');
        assert.equal('java.configuration.runtimes' in settings, false);

        // Gating for the Language Server steps: the write changed the file
        // and moved the server's JDK.
        assert.deepEqual([...state.changedProjects], [project]);
        assert.equal(state.jdtLsJavaHomeChanged, true);
    });

    it('leaves changedProjects and jdtLsJavaHomeChanged untouched on an idempotent re-run', async () => {
        const project = await projectDir();
        const buildState = () => {
            const state = createInitialState();
            state.platform = 'linux';
            state.projectContexts = [{
                workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
                javaVersion: '21',
                jdkHome: '/home/dev/.jaenvtix/jdk-21',
                toolHome: '/home/dev/.jaenvtix/jdk-21/mvn-custom',
                toolBin: '/home/dev/.jaenvtix/jdk-21/mvn-custom/bin',
                hasMvnw: false,
            }];
            return state;
        };

        await new ConfigureSettingsStep().run(buildState());

        const rerunState = buildState();
        await new ConfigureSettingsStep().run(rerunState);

        assert.equal(rerunState.changedProjects.size, 0);
        assert.equal(rerunState.jdtLsJavaHomeChanged, false);
    });

    it('does not flag jdtLsJavaHomeChanged for a Java < 21 project (key never written)', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '11',
            jdkHome: '/home/dev/.jaenvtix/jdk-11',
            toolHome: '/home/dev/.jaenvtix/jdk-11/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-11/mvn-custom/bin',
            hasMvnw: false,
        }];

        await new ConfigureSettingsStep().run(state);

        assert.deepEqual([...state.changedProjects], [project]);
        assert.equal(state.jdtLsJavaHomeChanged, false);
    });

    it('writes a runtimes array (and NOT java.jdt.ls.java.home) for Java < 21', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '11',
            jdkHome: '/home/dev/.jaenvtix/jdk-11',
            toolHome: '/home/dev/.jaenvtix/jdk-11/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-11/mvn-custom/bin',
            hasMvnw: false,
        }];

        await new ConfigureSettingsStep().run(state);
        const settings = JSON.parse(
            await fs.readFile(join(project, '.vscode', 'settings.json'), 'utf-8'),
        );

        assert.equal('java.jdt.ls.java.home' in settings, false);
        const runtimes = settings['java.configuration.runtimes'] as {name: string; path: string; default?: boolean}[];
        assert.equal(runtimes.length, 1);
        assert.equal(runtimes[0].name, 'JavaSE-11');
        assert.equal(runtimes[0].path, '/home/dev/.jaenvtix/jdk-11');
        assert.equal(runtimes[0].default, true);
    });

    it('writes one settings file per project context', async () => {
        const a = await projectDir();
        const b = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [
            {
                workspace: a, projectPath: a, platform: 'linux', arch: 'x64',
                javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
            },
            {
                workspace: b, projectPath: b, platform: 'linux', arch: 'x64',
                javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
            },
        ];

        await new ConfigureSettingsStep().run(state);

        assert.ok(existsSync(join(a, '.vscode', 'settings.json')));
        assert.ok(existsSync(join(b, '.vscode', 'settings.json')));
    });

    it('is a no-op when projectContexts is empty', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        const result = await new ConfigureSettingsStep().run(state);
        assert.equal(result.success, true);
    });

    // Business rule: the per-project decision of whether to point `maven.executable.path`
    // at the Jaenvtix wrapper depends on whether the project ships its own mvnw.
    // The ProjectContext.hasMvnw flag is the single source of truth for this decision.

    it('omits maven.executable.path, maven.executable.preferMavenWrapper AND maven.terminal.customEnv when projectContext.hasMvnw is true', async () => {
        // Three redundant keys when the project ships mvnw:
        // - `maven.executable.path` would point at a wrapper Jaenvtix is NOT going to use
        // - `maven.executable.preferMavenWrapper: true` is already vscode-maven's default
        // - `maven.terminal.customEnv` duplicates `terminal.integrated.env.*` for this folder
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '21',
            jdkHome: '/home/dev/.jaenvtix/jdk-21',
            toolHome: '/home/dev/.jaenvtix/jdk-21/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-21/mvn-custom/bin',
            hasMvnw: true,
        }];

        await new ConfigureSettingsStep().run(state);
        const settings = JSON.parse(
            await fs.readFile(join(project, '.vscode', 'settings.json'), 'utf-8'),
        );

        assert.equal('maven.executable.path' in settings, false);
        assert.equal('maven.executable.preferMavenWrapper' in settings, false);
        assert.equal('maven.terminal.customEnv' in settings, false);
        // terminal.integrated.env.* remains — it covers the Maven Explorer terminal
        // via VS Code core env injection.
        assert.ok(settings['terminal.integrated.env.linux']);
    });

    it('writes maven.executable.path pointing to the Jaenvtix wrapper of the paired JDK when hasMvnw is false', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '17',
            jdkHome: '/home/dev/.jaenvtix/jdk-17',
            toolHome: '/home/dev/.jaenvtix/jdk-17/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin',
            hasMvnw: false,
        }];

        await new ConfigureSettingsStep().run(state);
        const settings = JSON.parse(
            await fs.readFile(join(project, '.vscode', 'settings.json'), 'utf-8'),
        );

        const executablePath = settings['maven.executable.path'] as string;
        assert.ok(executablePath, 'expected maven.executable.path to be written');
        assert.match(executablePath, /jdk-17/);
        assert.match(executablePath, /jaenvtix-mvn/);
        assert.equal(settings['maven.executable.preferMavenWrapper'], false);
    });

    // Business rule: terminal env settings only apply to NEW terminals, so the
    // state flag drives a "reopen terminals" hint shown by the command entry point.

    it('flags terminalEnvUpdated when terminal env keys are written', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        await new ConfigureSettingsStep().run(state);
        assert.equal(state.terminalEnvUpdated, true);
    });

    it('does not flag terminalEnvUpdated on a no-op second run', async () => {
        const project = await projectDir();
        const state = createInitialState();
        state.platform = 'linux';
        state.projectContexts = [{
            workspace: project, projectPath: project, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        await new ConfigureSettingsStep().run(state);

        const secondRunState = createInitialState();
        secondRunState.platform = 'linux';
        secondRunState.projectContexts = state.projectContexts;
        await new ConfigureSettingsStep().run(secondRunState);

        assert.equal(secondRunState.terminalEnvUpdated, false);
    });
});
