import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {VerifyConfigurationStep} from '../../../src/configuration/steps/verifyConfigurationStep';
import {COMPILER_COMPLIANCE_KEY} from '../../../src/configuration/projectSettingsVerifier';
import {createInitialState, ProjectContext} from '../../../src/core/types';

function buildContext(projectPath: string, javaVersion: string): ProjectContext {
    return {
        workspace: '/ws',
        projectPath,
        platform: 'linux',
        arch: 'x64',
        javaVersion,
        jdkHome: `/jdk/${javaVersion}`,
        toolHome: '/maven',
        toolBin: '/maven/bin',
        hasMvnw: false,
    };
}

describe('VerifyConfigurationStep', () => {
    it('does not notify when every project matches its expected Java level', async () => {
        const notifications: string[] = [];
        const step = new VerifyConfigurationStep({
            readProjectSettings: async (projectPath) => ({
                [COMPILER_COMPLIANCE_KEY]: projectPath.includes('legacy') ? '1.8' : '17',
            }),
            notifyMismatch: (message) => notifications.push(message),
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'), buildContext('/ws/legacy', '8'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(notifications, []);
    });

    it('notifies once with the aggregated mismatch count', async () => {
        const notifications: string[] = [];
        const step = new VerifyConfigurationStep({
            readProjectSettings: async () => ({[COMPILER_COMPLIANCE_KEY]: '21'}),
            notifyMismatch: (message) => notifications.push(message),
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/a', '17'), buildContext('/ws/b', '11'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(notifications.length, 1);
        assert.match(notifications[0] ?? '', /2 projects/);
    });

    it('treats reader failures as unknown and stays silent', async () => {
        const notifications: string[] = [];
        const step = new VerifyConfigurationStep({
            readProjectSettings: async () => {
                throw new Error('LightWeight mode');
            },
            notifyMismatch: (message) => notifications.push(message),
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(notifications, []);
    });

    it('treats an unavailable API (undefined settings) as unknown, not mismatch', async () => {
        const notifications: string[] = [];
        const step = new VerifyConfigurationStep({
            readProjectSettings: async () => undefined,
            notifyMismatch: (message) => notifications.push(message),
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(notifications, []);
    });

    it('succeeds without reading anything when there are no project contexts', async () => {
        let reads = 0;
        const step = new VerifyConfigurationStep({
            readProjectSettings: async () => {
                reads++;
                return undefined;
            },
            notifyMismatch: () => { /* unused */ },
        });

        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal(reads, 0);
    });
});
