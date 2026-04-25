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
        }];

        const result = await new ConfigureSettingsStep().run(state);
        assert.equal(result.success, true);

        const settingsPath = join(project, '.vscode', 'settings.json');
        assert.ok(existsSync(settingsPath));
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        assert.equal(settings['java.jdt.ls.java.home'], '/home/dev/.jaenvtix/jdk-21');
        assert.equal('java.configuration.runtimes' in settings, false);
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
                javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b',
            },
            {
                workspace: b, projectPath: b, platform: 'linux', arch: 'x64',
                javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b',
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
});
