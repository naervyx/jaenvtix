import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    ConfigureUserRuntimesDeps,
    ConfigureUserRuntimesStep,
} from '../../../src/configuration/steps/configureUserRuntimesStep';
import {createInitialState, JavaConfigurationState, JavaRuntime} from '../../../src/core/types';

/**
 * In-memory stand-in for the User Settings layer of
 * `java.configuration.runtimes`. `rejectWrite` reproduces VS Code refusing a
 * write to a setting no installed extension registered, which is what happens
 * when `redhat.java` is absent.
 */
function makeDeps(options: {
    existing?: JavaRuntime[];
    rejectWrite?: boolean;
} = {}): {writes: JavaRuntime[][]; deps: ConfigureUserRuntimesDeps} {
    const writes: JavaRuntime[][] = [];
    return {
        writes,
        deps: {
            readGlobalRuntimes: () => options.existing,
            isPathFixEnabled: () => true,
            platform: 'linux',
            writeGlobalRuntimes: async (runtimes) => {
                if (options.rejectWrite) {
                    throw new Error(
                        'Unable to write to User Settings because java.configuration.runtimes is not a registered configuration.'
                    );
                }
                writes.push(runtimes);
            },
        },
    };
}

function stateWithJdk(version: string, jdkHome: string): JavaConfigurationState {
    const state = createInitialState();
    state.versionPaths.set(version, {jdkHome, toolHome: '/tool', toolBin: '/tool/bin'});
    return state;
}

describe('ConfigureUserRuntimesStep', () => {
    it('writes the staged JDKs to the user-level runtimes', async () => {
        const {writes, deps} = makeDeps();
        const step = new ConfigureUserRuntimesStep(deps);

        const result = await step.run(stateWithJdk('21', '/jdks/21'));

        assert.equal(result.success, true);
        assert.deepEqual(writes, [[{name: 'JavaSE-21', path: '/jdks/21'}]]);
    });

    it('succeeds when the write is refused because the setting is not registered', async () => {
        // `java.configuration.runtimes` is registered by redhat.java, which is
        // not a hard dependency. Propagating the rejection would abort the
        // pipeline before every step that follows this one.
        const {writes, deps} = makeDeps({rejectWrite: true});
        const step = new ConfigureUserRuntimesStep(deps);

        const result = await step.run(stateWithJdk('21', '/jdks/21'));

        assert.equal(result.success, true);
        assert.equal(result.message, undefined);
        assert.deepEqual(writes, []);
    });

    it('does not write when no JDK was staged in this run', async () => {
        const {writes, deps} = makeDeps();
        const step = new ConfigureUserRuntimesStep(deps);

        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.deepEqual(writes, []);
    });

    it('reads the Global layer only, so workspace-declared runtimes are not merged', async () => {
        // A `.code-workspace` declaring runtimes must not make this step
        // conclude "nothing to add": the orchestrator wires readGlobalRuntimes
        // to inspect().globalValue precisely so the workspace layer is invisible
        // here. An empty Global layer means the staged JDK is still written.
        const {writes, deps} = makeDeps({existing: undefined});
        const step = new ConfigureUserRuntimesStep(deps);

        await step.run(stateWithJdk('17', '/jdks/17'));

        assert.deepEqual(writes, [[{name: 'JavaSE-17', path: '/jdks/17'}]]);
    });
});
