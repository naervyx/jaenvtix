import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {ApplyUserTuningsStep} from '../../../src/configuration/steps/applyUserTuningsStep';
import {createInitialState} from '../../../src/core/types';

function makeConfig(initial: Record<string, unknown> = {}): {
    store: Record<string, unknown>;
    factory: () => {get(key: string): unknown; update(key: string, value: unknown, target: number): Promise<void>};
} {
    const store = {...initial};
    return {
        store,
        factory: () => ({
            get: (key: string) => store[key],
            update: async (key: string, value: unknown) => { store[key] = value; },
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
});
