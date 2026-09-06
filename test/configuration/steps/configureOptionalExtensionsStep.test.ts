import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {ConfigureOptionalExtensionsStep} from '../../../src/configuration/steps/configureOptionalExtensionsStep';
import {createInitialState, JavaConfigurationState} from '../../../src/core/types';

function makeConfig(initial: Record<string, unknown> = {}, unregistered: string[] = []): {
    store: Record<string, unknown>;
    factory: () => {
        get(key: string): unknown;
        inspect(key: string): {globalValue?: unknown} | undefined;
        update(key: string, value: unknown, target: number): Promise<void>;
    };
} {
    const store = {...initial};
    return {
        store,
        factory: () => ({
            get: (key: string) => store[key],
            inspect: (key: string) => ({globalValue: store[key]}),
            update: async (key: string, value: unknown) => {
                // Mirrors the real API, which rejects for a setting no
                // installed extension registered.
                if (unregistered.includes(key)) {
                    throw new Error(`Unable to write to User Settings because ${key} is not a registered configuration.`);
                }
                store[key] = value;
            },
        }),
    };
}

function stateWithJdk21(): JavaConfigurationState {
    const state = createInitialState();
    state.versionPaths.set('21', {jdkHome: '/jdks/21', toolHome: '/maven/21', toolBin: '/maven/21/bin'});
    return state;
}

const springBootInstalled = (extensionId: string) => extensionId === 'vmware.vscode-spring-boot';

describe('ConfigureOptionalExtensionsStep', () => {
    it('writes spring-boot.ls.java.home when Spring Boot Tools is installed', async () => {
        const {store, factory} = makeConfig();
        const step = new ConfigureOptionalExtensionsStep(factory, springBootInstalled);
        const result = await step.run(stateWithJdk21());

        assert.equal(result.success, true);
        assert.equal(store['spring-boot.ls.java.home'], '/jdks/21');
    });

    it('does not overwrite a value the user already set globally', async () => {
        const {store, factory} = makeConfig({'spring-boot.ls.java.home': '/my/custom/jdk'});
        const step = new ConfigureOptionalExtensionsStep(factory, springBootInstalled);
        await step.run(stateWithJdk21());

        assert.equal(store['spring-boot.ls.java.home'], '/my/custom/jdk');
    });

    it('writes nothing when the extension is absent', async () => {
        const {store, factory} = makeConfig();
        const step = new ConfigureOptionalExtensionsStep(factory, () => false);
        await step.run(stateWithJdk21());

        assert.equal('spring-boot.ls.java.home' in store, false);
    });

    it('writes nothing when no provisioned JDK satisfies Java 21+', async () => {
        const {store, factory} = makeConfig();
        const step = new ConfigureOptionalExtensionsStep(factory, springBootInstalled);
        const state = createInitialState();
        state.versionPaths.set('17', {jdkHome: '/jdks/17', toolHome: '/maven/17', toolBin: '/maven/17/bin'});
        await step.run(state);

        assert.equal('spring-boot.ls.java.home' in store, false);
    });

    it('keeps the other writes and succeeds when a setting is not registered', async () => {
        // An installed extension is not a guarantee that it registers the
        // setting: vmware.vscode-boot-dev-pack is a pack, and the member that
        // owns spring-boot.ls.java.home can be uninstalled while the pack
        // stays. The refusal must not cost the run its remaining steps.
        const {store, factory} = makeConfig({}, ['spring-boot.ls.java.home']);
        const bothInstalled = (extensionId: string) =>
            extensionId === 'vmware.vscode-spring-boot' || extensionId === 'vscjava.vscode-spring-initializr';
        const step = new ConfigureOptionalExtensionsStep(factory, bothInstalled);

        const result = await step.run(stateWithJdk21());

        assert.equal(result.success, true);
        assert.equal('spring-boot.ls.java.home' in store, false);
        assert.equal(store['spring.initializr.defaultJavaVersion'], '21');
    });

    it('skips all writes when jaenvtix.configureOptionalExtensions is false (opt-out)', async () => {
        const {store, factory} = makeConfig({'jaenvtix.configureOptionalExtensions': false});
        const step = new ConfigureOptionalExtensionsStep(factory, springBootInstalled);
        await step.run(stateWithJdk21());

        assert.equal('spring-boot.ls.java.home' in store, false);
    });
});
