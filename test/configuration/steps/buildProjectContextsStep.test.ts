import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {BuildProjectContextsStep} from '../../../src/configuration/steps/buildProjectContextsStep';
import {createInitialState} from '../../../src/core/types';

describe('BuildProjectContextsStep', () => {
    it('errors when platform/arch/workspaceFolders are missing', async () => {
        const state = createInitialState();
        const result = await new BuildProjectContextsStep().run(state);
        assert.equal(result.kind, 'error');
    });

    it('emits one ProjectContext per project, hydrated from versionPaths', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.workspaceFolders = ['/ws'];
        state.projectVersionMap.set('17', ['/ws/service-a', '/ws/service-b']);
        state.versionPaths.set('17', {
            jdkHome: '/home/dev/.jaenvtix/jdk-17',
            toolHome: '/home/dev/.jaenvtix/jdk-17/mvn-custom',
            toolBin: '/home/dev/.jaenvtix/jdk-17/mvn-custom/bin',
        });

        const result = await new BuildProjectContextsStep().run(state);

        assert.equal(result.success, true);
        assert.equal(state.projectContexts.length, 2);
        assert.equal(state.projectContexts[0].javaVersion, '17');
        assert.equal(state.projectContexts[0].jdkHome, '/home/dev/.jaenvtix/jdk-17');
        assert.equal(state.projectContexts[0].workspace, '/ws');
        assert.equal(state.projectContexts[0].platform, 'linux');
        assert.equal(state.projectContexts[0].arch, 'x64');
    });

    it('falls back to projectPath as workspace when no workspaceFolder contains the project', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.workspaceFolders = ['/other-ws'];
        state.projectVersionMap.set('21', ['/standalone/project']);
        state.versionPaths.set('21', {jdkHome: '/j', toolHome: '/m', toolBin: '/m/b'});

        await new BuildProjectContextsStep().run(state);

        assert.equal(state.projectContexts[0].workspace, '/standalone/project');
    });

    it('picks the longest matching workspaceFolder when multiple contain the project', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.workspaceFolders = ['/ws', '/ws/sub'];
        state.projectVersionMap.set('17', ['/ws/sub/svc']);
        state.versionPaths.set('17', {jdkHome: '/j', toolHome: '/m', toolBin: '/m/b'});

        await new BuildProjectContextsStep().run(state);

        assert.equal(state.projectContexts[0].workspace, '/ws/sub');
    });

    it('skips Java versions that have no entry in versionPaths', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.workspaceFolders = ['/ws'];
        state.projectVersionMap.set('17', ['/ws/a']);
        state.projectVersionMap.set('99', ['/ws/b']);
        state.versionPaths.set('17', {jdkHome: '/j', toolHome: '/m', toolBin: '/m/b'});

        await new BuildProjectContextsStep().run(state);

        assert.equal(state.projectContexts.length, 1);
        assert.equal(state.projectContexts[0].javaVersion, '17');
    });

    it('clears existing projectContexts before rebuilding', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.workspaceFolders = ['/ws'];
        state.projectVersionMap.set('17', ['/ws/a']);
        state.versionPaths.set('17', {jdkHome: '/j', toolHome: '/m', toolBin: '/m/b'});
        state.projectContexts.push({
            workspace: '/stale', projectPath: '/stale', platform: 'linux', arch: 'x64',
            javaVersion: 'old', jdkHome: '/x', toolHome: '/x', toolBin: '/x',
        });

        await new BuildProjectContextsStep().run(state);

        assert.equal(state.projectContexts.length, 1);
        assert.equal(state.projectContexts[0].javaVersion, '17');
    });
});
