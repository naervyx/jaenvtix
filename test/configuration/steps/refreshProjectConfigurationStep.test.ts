import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';

import {RefreshProjectConfigurationStep} from '../../../src/configuration/steps/refreshProjectConfigurationStep';
import {createInitialState, ProjectContext} from '../../../src/core/types';

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

describe('RefreshProjectConfigurationStep', () => {
    it('skips the refresh entirely when the Red Hat extension is missing', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            resolveRedhatApi: async () => undefined,
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

    it('refreshes every project pom after serverReady resolves', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            resolveRedhatApi: async () => ({serverReady: () => Promise.resolve(true)}),
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'), buildContext('/ws/lib'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, [join('/ws/app', 'pom.xml'), join('/ws/lib', 'pom.xml')]);
    });

    it('still refreshes best-effort when readiness is unconfirmed (timeout)', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            resolveRedhatApi: async () => ({
                serverReady: () => new Promise(() => { /* never settles */ }),
            }),
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
            },
            serverReadyTimeoutMs: 10,
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(refreshed, [join('/ws/app', 'pom.xml')]);
    });

    it('succeeds without touching the API when there are no project contexts', async () => {
        let apiResolved = false;
        const step = new RefreshProjectConfigurationStep({
            resolveRedhatApi: async () => {
                apiResolved = true;
                return undefined;
            },
            refreshProject: async () => { /* unused */ },
        });

        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal(apiResolved, false);
    });

    it('keeps per-pom refresh failures isolated and succeeds', async () => {
        const refreshed: string[] = [];
        const step = new RefreshProjectConfigurationStep({
            resolveRedhatApi: async () => ({serverReady: () => Promise.resolve(true)}),
            refreshProject: async (pomPath) => {
                refreshed.push(pomPath);
                if (pomPath.includes('app')) {
                    throw new Error('boom');
                }
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'), buildContext('/ws/lib'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(refreshed.length, 2);
    });
});
