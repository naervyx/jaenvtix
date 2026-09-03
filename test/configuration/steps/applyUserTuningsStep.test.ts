import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {ApplyUserTuningsStep, UserConfig} from '../../../src/configuration/steps/applyUserTuningsStep';
import {createInitialState} from '../../../src/core/types';

/**
 * In-memory fake mirroring the vscode configuration split the step relies on:
 * `store` holds user-set values (surfaced via `inspect().globalValue`);
 * `registeredDefaults` holds extension-declared defaults (surfaced via `get`
 * when the user set nothing, exactly like the real API); `unregistered` lists
 * keys whose owning extension is not installed, for which the real `update`
 * rejects instead of writing.
 */
function makeConfig(
    initial: Record<string, unknown> = {},
    registeredDefaults: Record<string, unknown> = {},
    unregistered: string[] = [],
): {store: Record<string, unknown>; factory: () => UserConfig} {
    const store = {...initial};
    return {
        store,
        factory: () => ({
            get: (key: string) => key in store ? store[key] : registeredDefaults[key],
            inspect: (key: string) => key in store ? {globalValue: store[key]} : undefined,
            update: async (key: string, value: unknown) => {
                if (unregistered.includes(key)) {
                    throw new Error(`Unable to write to User Settings because ${key} is not a registered configuration.`);
                }
                store[key] = value;
            },
        }),
    };
}

describe('ApplyUserTuningsStep', () => {
    it('writes 4 tunings on Linux when no keys are pre-set', async () => {
        const {store, factory} = makeConfig();
        const step = new ApplyUserTuningsStep(factory, 'linux');
        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal(store['java.debug.settings.hotCodeReplace'], 'auto');
        assert.notEqual(store['java.maxConcurrentBuilds'], undefined);
        assert.equal(store['java.dependency.packagePresentation'], 'hierarchical');
        assert.equal(store['java.sources.organizeImports.staticStarThreshold'], 1);
        assert.equal('java.test.config' in store, false);
    });

    it('writes 5 tunings on Windows (includes java.test.config)', async () => {
        const {store, factory} = makeConfig();
        const step = new ApplyUserTuningsStep(factory, 'win32');
        await step.run(createInitialState());

        assert.deepEqual(store['java.test.config'], [{name: 'Jaenvtix UTF-8', vmArgs: ['-Dfile.encoding=UTF-8']}]);
    });

    it('does not overwrite a key the user has already set', async () => {
        const {store, factory} = makeConfig({'java.debug.settings.hotCodeReplace': 'manual'});
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal(store['java.debug.settings.hotCodeReplace'], 'manual');
    });

    it('applies tunings even when the owning extension registered defaults', async () => {
        // With the Java pack installed, `get` returns registered defaults for
        // every key; only `inspect` reveals the user never set them. The step
        // must still apply the tunings in that scenario.
        const {store, factory} = makeConfig({}, {
            'java.debug.settings.hotCodeReplace': 'manual',
            'java.dependency.packagePresentation': 'flat',
        });
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal(store['java.debug.settings.hotCodeReplace'], 'auto');
        assert.equal(store['java.dependency.packagePresentation'], 'hierarchical');
    });

    it('skips the hotCodeReplace tuning when the user disabled autobuild', async () => {
        // Auto HCR only acts after an automatic build — seeding it with
        // autobuild off would be a misleading no-op.
        const {store, factory} = makeConfig({'java.autobuild.enabled': false});
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal('java.debug.settings.hotCodeReplace' in store, false);
        // The remaining tunings still apply.
        assert.equal(store['java.dependency.packagePresentation'], 'hierarchical');
    });

    it('never writes java.autobuild.enabled back (read-only gate)', async () => {
        const {store, factory} = makeConfig({}, {'java.autobuild.enabled': true});
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal('java.autobuild.enabled' in store, false);
    });

    it('skips all writes when jaenvtix.applyJavaTunings is false (opt-out)', async () => {
        const {store, factory} = makeConfig({'jaenvtix.applyJavaTunings': false});
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal('java.debug.settings.hotCodeReplace' in store, false);
    });

    it('proceeds when jaenvtix.applyJavaTunings is undefined (default on)', async () => {
        const {store, factory} = makeConfig();
        const step = new ApplyUserTuningsStep(factory, 'linux');
        await step.run(createInitialState());

        assert.equal(store['java.debug.settings.hotCodeReplace'], 'auto');
    });

    it('keeps the remaining tunings and succeeds when a key is not registered', async () => {
        // Test Runner for Java (vscjava.vscode-java-test) not installed, so
        // `java.test.config` is unknown to VS Code and `update` rejects. Letting
        // that reject would abort the pipeline before the five steps that follow
        // this one, among them the workspace extension recommendations.
        const {store, factory} = makeConfig({}, {}, ['java.test.config']);
        const step = new ApplyUserTuningsStep(factory, 'win32');
        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal('java.test.config' in store, false);
        assert.equal(store['java.debug.settings.hotCodeReplace'], 'auto');
        assert.notEqual(store['java.maxConcurrentBuilds'], undefined);
        assert.equal(store['java.dependency.packagePresentation'], 'hierarchical');
        assert.equal(store['java.sources.organizeImports.staticStarThreshold'], 1);
    });

    it('still writes the tunings that come after an unregistered key', async () => {
        const {store, factory} = makeConfig({}, {}, ['java.maxConcurrentBuilds']);
        const step = new ApplyUserTuningsStep(factory, 'win32');
        const result = await step.run(createInitialState());

        assert.equal(result.success, true);
        assert.equal('java.maxConcurrentBuilds' in store, false);
        assert.equal(store['java.dependency.packagePresentation'], 'hierarchical');
        assert.equal(store['java.sources.organizeImports.staticStarThreshold'], 1);
        assert.notEqual(store['java.test.config'], undefined);
    });
});
