import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {AwaitLanguageServerStep} from '../../../src/configuration/steps/awaitLanguageServerStep';
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

// Business rules:
// - The wait only happens when a project changed this run or the previous
//   run flagged a mismatch (backlog). Idempotent runs never touch the API.
// - The backlog is narrowed to projects present in the current contexts.
// - The wait result lands on the state for the downstream steps.

describe('AwaitLanguageServerStep', () => {
    it('skips the wait entirely on an idempotent run (no changes, no backlog)', async () => {
        let apiResolved = false;
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => {
                apiResolved = true;
                return {serverReady: () => Promise.resolve(true)};
            },
            getMismatchBacklog: () => [],
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(apiResolved, false);
        assert.equal(state.languageServerWait, undefined);
    });

    it('waits and records the outcome when a project changed', async () => {
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => ({serverReady: () => Promise.resolve(true)}),
            getMismatchBacklog: () => [],
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));
        state.changedProjects.add('/ws/app');

        await step.run(state);

        assert.equal(state.languageServerWait?.outcome, 'ready');
    });

    it('waits when only the backlog demands re-verification (no changes)', async () => {
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => ({serverReady: () => Promise.resolve(true)}),
            getMismatchBacklog: () => ['/ws/app'],
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));

        await step.run(state);

        assert.deepEqual(state.verificationBacklog, ['/ws/app']);
        assert.equal(state.languageServerWait?.outcome, 'ready');
    });

    it('narrows the backlog to projects that still exist in the contexts', async () => {
        let apiResolved = false;
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => {
                apiResolved = true;
                return {serverReady: () => Promise.resolve(true)};
            },
            getMismatchBacklog: () => ['/ws/gone', '/elsewhere/project'],
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));

        await step.run(state);

        // Nothing current is flagged → no wait either.
        assert.deepEqual(state.verificationBacklog, []);
        assert.equal(apiResolved, false);
    });

    it('records a timeout outcome with the live continuation promise', async () => {
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => ({
                serverReady: () => new Promise(() => { /* never settles */ }),
            }),
            getMismatchBacklog: () => [],
            serverReadyTimeoutMs: 10,
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));
        state.changedProjects.add('/ws/app');

        await step.run(state);

        assert.equal(state.languageServerWait?.outcome, 'timeout');
        assert.ok(state.languageServerWait?.becameReady);
    });

    it('records lightweight mode without waiting (user choice, correct no-op)', async () => {
        const step = new AwaitLanguageServerStep({
            resolveRedhatApi: async () => ({
                serverMode: 'LightWeight',
                serverReady: () => new Promise(() => { /* never settles */ }),
            }),
            getMismatchBacklog: () => [],
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app'));
        state.changedProjects.add('/ws/app');

        await step.run(state);

        assert.equal(state.languageServerWait?.outcome, 'lightweight');
    });
});
