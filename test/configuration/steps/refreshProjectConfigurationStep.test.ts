import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';

import {RefreshProjectConfigurationStep} from '../../../src/configuration/steps/refreshProjectConfigurationStep';
import {createInitialState, JavaConfigurationState, ProjectContext} from '../../../src/core/types';

function buildContext(projectPath: string): ProjectContext {
    return {
        workspace: '/ws',
        projectPath,
        platform: 'linux',
        arch: 'x64',
        javaVersion: '17',
        jdkHome: '/jdk/17',
        toolHome: '/maven',
        toolBin: '/maven/bin',
        hasMvnw: false,
    };
}

function stateWithChangedProjects(...projectPaths: string[]): JavaConfigurationState {
    const state = createInitialState();
    for (const projectPath of projectPaths) {
        state.projectContexts.push(buildContext(projectPath));
        state.changedProjects.add(projectPath);
    }
    return state;
}

// Business rules:
// - Only projects whose settings changed this run are refreshed; an
//   idempotent run is an instant no-op that never calls the refresher.
// - The step trusts the wait outcome recorded by AwaitLanguageServerStep:
//   'ready'/'unconfirmed' proceed, 'timeout'/'lightweight'/'extension-missing'
//   skip (timeout is handled later by the orchestrator's continuation).
// - Per-pom failures stay isolated.

describe('RefreshProjectConfigurationStep', () => {
    it('refreshes only the changed projects', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'), buildContext('/ws/lib'));
        state.changedProjects.add('/ws/app');
        state.languageServerWait = {outcome: 'ready'};

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, [join('/ws/app', 'pom.xml')]);
    });

    it('is an instant no-op when nothing changed (idempotent run)', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, []);
    });

    it('skips when the Red Hat extension is missing', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = stateWithChangedProjects('/ws/app');
        state.languageServerWait = {outcome: 'extension-missing'};

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, []);
    });

    it('skips in LightWeight mode (no Standard server to notify)', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = stateWithChangedProjects('/ws/app');
        state.languageServerWait = {outcome: 'lightweight'};

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, []);
    });

    it('defers on timeout: the orchestrator continuation re-runs it once ready', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = stateWithChangedProjects('/ws/app');
        state.languageServerWait = {
            outcome: 'timeout',
            becameReady: new Promise(() => { /* still loading */ }),
        };

        const result = await step.run(state);
        assert.equal(result.success, true);
        assert.deepEqual(refreshed, []);

        // Continuation flow: once the server is ready the orchestrator flips
        // the outcome and re-runs the step, which then refreshes normally.
        state.languageServerWait = {outcome: 'ready'};
        await step.run(state);
        assert.deepEqual(refreshed, [join('/ws/app', 'pom.xml')]);
    });

    it('still refreshes best-effort when readiness is unconfirmed (old API)', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = stateWithChangedProjects('/ws/app');
        state.languageServerWait = {outcome: 'unconfirmed'};

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, [join('/ws/app', 'pom.xml')]);
    });

    it('succeeds without work when there are no project contexts', async () => {
        let refreshCalls = 0;
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async () => {
                refreshCalls++;
            },
        });

        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal(refreshCalls, 0);
    });

    it('keeps per-pom refresh failures isolated and succeeds', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
                if (pomPath.includes('app')) {
                    throw new Error('boom');
                }
            },
        });

        const state = stateWithChangedProjects('/ws/app', '/ws/lib');
        state.languageServerWait = {outcome: 'ready'};

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(refreshed.length, 2);
    });
});
