import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

import {VerifyConfigurationStep, VerifyConfigurationDeps} from '../../../src/configuration/steps/verifyConfigurationStep';
import {COMPILER_COMPLIANCE_KEY} from '../../../src/configuration/projectSettingsVerifier';
import {createInitialState, JavaConfigurationState, ProjectContext} from '../../../src/core/types';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

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

interface Harness {
    step: VerifyConfigurationStep;
    notifications: string[];
    mementoWrites: string[][];
}

function buildStep(deps: Partial<VerifyConfigurationDeps>): Harness {
    const notifications: string[] = [];
    const mementoWrites: string[][] = [];
    const step = new VerifyConfigurationStep({
        readProjectSettings: async () => undefined,
        notifyMismatch: (message) => notifications.push(message),
        updateMismatchMemento: (paths) => {
            mementoWrites.push([...paths]);
        },
        hasMainJavaSources: () => true,
        ...deps,
    });
    return {step, notifications, mementoWrites};
}

function readyState(...contexts: ProjectContext[]): JavaConfigurationState {
    const state = createInitialState();
    for (const context of contexts) {
        state.projectContexts.push(context);
        state.changedProjects.add(context.projectPath);
    }
    state.languageServerWait = {outcome: 'ready'};
    return state;
}

// Business rules:
// - Verifies only changed projects plus the backlog from the previous run;
//   idempotent runs read nothing.
// - Never verifies by the clock: timeout defers to the continuation.
// - Aggregators (no src/main/java) are skipped — JDT resolves a default
//   compliance for them, which is not a Jaenvtix mismatch.
// - Memento: mismatches recorded; ok clears; unknown keeps a flagged project.
// - Single mismatch → actionable message naming the folder; several → count.

describe('VerifyConfigurationStep', () => {
    it('does not notify when every verified project matches its expected Java level', async () => {
        const {step, notifications, mementoWrites} = buildStep({
            readProjectSettings: async (projectPath) => ({
                [COMPILER_COMPLIANCE_KEY]: projectPath.includes('legacy') ? '1.8' : '17',
            }),
        });

        const state = readyState(buildContext('/ws/app', '17'), buildContext('/ws/legacy', '8'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(notifications, []);
        // All resolved → the backlog is cleared for the next run.
        assert.deepEqual(mementoWrites, [[]]);
    });

    it('reads nothing on an idempotent run (no changes, no backlog)', async () => {
        let reads = 0;
        const {step, mementoWrites} = buildStep({
            readProjectSettings: async () => {
                reads++;
                return undefined;
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(reads, 0);
        assert.deepEqual(mementoWrites, []);
    });

    it('verifies only the changed projects, not the whole workspace', async () => {
        const read: string[] = [];
        const {step} = buildStep({
            readProjectSettings: async (projectPath) => {
                read.push(projectPath);
                return {[COMPILER_COMPLIANCE_KEY]: '17'};
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'), buildContext('/ws/lib', '17'));
        state.changedProjects.add('/ws/app');
        state.languageServerWait = {outcome: 'ready'};

        await step.run(state);

        assert.deepEqual(read, ['/ws/app']);
    });

    it('re-verifies backlog projects even when nothing changed', async () => {
        const read: string[] = [];
        const {step, mementoWrites} = buildStep({
            readProjectSettings: async (projectPath) => {
                read.push(projectPath);
                return {[COMPILER_COMPLIANCE_KEY]: '17'};
            },
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/app', '17'));
        state.verificationBacklog = ['/ws/app'];
        state.languageServerWait = {outcome: 'ready'};

        await step.run(state);

        assert.deepEqual(read, ['/ws/app']);
        // Resolved now → cleared.
        assert.deepEqual(mementoWrites, [[]]);
    });

    it('notifies a single mismatch with the folder name, actual and expected levels', async () => {
        const {step, notifications, mementoWrites} = buildStep({
            readProjectSettings: async () => ({[COMPILER_COMPLIANCE_KEY]: '17'}),
        });

        const state = readyState(buildContext('/ws/java-spring', '21'));

        await step.run(state);

        assert.equal(notifications.length, 1);
        assert.match(notifications[0] ?? '', /"java-spring" is still compiling at Java 17/);
        assert.match(notifications[0] ?? '', /pom requests Java 21/);
        assert.match(notifications[0] ?? '', /after a restart/);
        assert.equal(state.mismatchNotified, true);
        assert.deepEqual(mementoWrites, [['/ws/java-spring']]);
    });

    it('aggregates several mismatches into one count-based notification', async () => {
        const {step, notifications} = buildStep({
            readProjectSettings: async () => ({[COMPILER_COMPLIANCE_KEY]: '21'}),
        });

        const state = readyState(buildContext('/ws/a', '17'), buildContext('/ws/b', '11'));

        await step.run(state);

        assert.equal(notifications.length, 1);
        assert.match(notifications[0] ?? '', /2 projects/);
    });

    it('skips aggregator projects (no src/main/java) without reading their settings', async () => {
        const read: string[] = [];
        const {step, notifications, mementoWrites} = buildStep({
            readProjectSettings: async (projectPath) => {
                read.push(projectPath);
                return {[COMPILER_COMPLIANCE_KEY]: '17'};
            },
            hasMainJavaSources: (projectPath) => !projectPath.includes('parent'),
        });

        const state = readyState(buildContext('/ws/parent', '21'), buildContext('/ws/app', '17'));

        await step.run(state);

        assert.deepEqual(read, ['/ws/app']);
        assert.deepEqual(notifications, []);
        // The aggregator can never verify → it must not linger in the backlog.
        assert.deepEqual(mementoWrites, [[]]);
    });

    it('probes src/main/java on the real filesystem by default', async () => {
        const root = await createTempDir();
        try {
            const withSources = join(root, 'app');
            const aggregator = join(root, 'parent');
            mkdirSync(join(withSources, 'src', 'main', 'java'), {recursive: true});
            mkdirSync(aggregator, {recursive: true});

            const read: string[] = [];
            const notifications: string[] = [];
            const step = new VerifyConfigurationStep({
                readProjectSettings: async (projectPath) => {
                    read.push(projectPath);
                    return {[COMPILER_COMPLIANCE_KEY]: '17'};
                },
                notifyMismatch: (message) => notifications.push(message),
                updateMismatchMemento: () => { /* not asserted here */ },
            });

            const state = readyState(buildContext(withSources, '17'), buildContext(aggregator, '21'));

            await step.run(state);

            assert.deepEqual(read, [withSources]);
            assert.deepEqual(notifications, []);
        } finally {
            await removeTempDir(root);
        }
    });

    it('defers entirely on timeout (never verifies by the clock)', async () => {
        let reads = 0;
        const {step, mementoWrites} = buildStep({
            readProjectSettings: async () => {
                reads++;
                return undefined;
            },
        });

        const state = readyState(buildContext('/ws/app', '17'));
        state.languageServerWait = {
            outcome: 'timeout',
            becameReady: new Promise(() => { /* still loading */ }),
        };

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(reads, 0);
        // Flags must survive untouched for the continuation / next run.
        assert.deepEqual(mementoWrites, []);
    });

    it('skips silently in LightWeight mode and when the extension is missing', async () => {
        for (const outcome of ['lightweight', 'extension-missing'] as const) {
            let reads = 0;
            const {step, notifications} = buildStep({
                readProjectSettings: async () => {
                    reads++;
                    return undefined;
                },
            });

            const state = readyState(buildContext('/ws/app', '17'));
            state.languageServerWait = {outcome};

            const result = await step.run(state);

            assert.equal(result.success, true, outcome);
            assert.equal(reads, 0, outcome);
            assert.deepEqual(notifications, [], outcome);
        }
    });

    it('treats reader failures as unknown and stays silent', async () => {
        const {step, notifications} = buildStep({
            readProjectSettings: async () => {
                throw new Error('LightWeight mode');
            },
        });

        const state = readyState(buildContext('/ws/app', '17'));

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.deepEqual(notifications, []);
    });

    it('keeps a flagged project in the backlog when its answer is unknown (not resolved)', async () => {
        const {step, mementoWrites, notifications} = buildStep({
            readProjectSettings: async () => undefined,
        });

        const state = createInitialState();
        state.projectContexts.push(buildContext('/ws/flagged', '17'), buildContext('/ws/changed', '17'));
        state.verificationBacklog = ['/ws/flagged'];
        state.changedProjects.add('/ws/changed');
        state.languageServerWait = {outcome: 'ready'};

        await step.run(state);

        // The flagged project stays; the changed-but-unknown one is not added
        // (only a confirmed mismatch flags a project).
        assert.deepEqual(mementoWrites, [['/ws/flagged']]);
        assert.deepEqual(notifications, []);
    });

    it('succeeds without reading anything when there are no project contexts', async () => {
        let reads = 0;
        const {step} = buildStep({
            readProjectSettings: async () => {
                reads++;
                return undefined;
            },
        });

        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal(reads, 0);
    });
});
