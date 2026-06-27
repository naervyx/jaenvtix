import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {DetectInstalledJdksStep} from '../../../src/configuration/steps/detectInstalledJdksStep';
import {createInitialState, JavaConfigurationState} from '../../../src/core/types';
import type {DetectedJdk} from '../../../src/build/jdkDetection';

function stateRequiring(...versions: string[]): JavaConfigurationState {
    const state = createInitialState();
    for (const version of versions) {
        state.projectVersionMap.set(version, [`/projects/app-${version}`]);
    }
    return state;
}

const jdk = (homedir: string, major: number, extra: Partial<DetectedJdk> = {}): DetectedJdk => ({
    homedir,
    version: {major},
    hasJavac: true,
    ...extra,
});

describe('DetectInstalledJdksStep — toolchains.xml discovery', () => {
    it('adds a valid toolchains entry and skips one that fails JDK validation', async () => {
        const state = stateRequiring('17', '21');
        const step = new DetectInstalledJdksStep({
            findRuntimes: async () => [],
            readToolchainsJdks: () => [
                {jdkHome: '/opt/jdk-17-corretto', version: '17'},
                {jdkHome: '/broken/path', version: '21'},
            ],
            inspectJdk: async (jdkHome) =>
                jdkHome === '/opt/jdk-17-corretto' ? jdk(jdkHome, 17) : undefined,
        });

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(state.detectedJdks.get('17'), '/opt/jdk-17-corretto');
        assert.equal(state.detectedJdks.has('21'), false);
    });

    it('does not read toolchains.xml when discovery is disabled', async () => {
        const state = stateRequiring('17');
        let readerCalled = false;
        const step = new DetectInstalledJdksStep({
            findRuntimes: async () => [],
            readToolchainsJdks: () => { readerCalled = true; return []; },
            isToolchainsDiscoveryEnabled: () => false,
        });

        await step.run(state);

        assert.equal(readerCalled, false);
        assert.equal(state.detectedJdks.size, 0);
    });

    it('prefers a system JDK (JAVA_HOME) over a toolchains entry for the same version', async () => {
        const state = stateRequiring('17');
        const step = new DetectInstalledJdksStep({
            findRuntimes: async () => [jdk('/system/jdk-17', 17, {isJavaHomeEnv: true})],
            readToolchainsJdks: () => [{jdkHome: '/toolchains/jdk-17', version: '17'}],
            inspectJdk: async (jdkHome) => jdk(jdkHome, 17),
        });

        await step.run(state);

        assert.equal(state.detectedJdks.get('17'), '/system/jdk-17');
    });

    it('does not revalidate a toolchains path the system scan already found', async () => {
        const state = stateRequiring('17');
        const inspected: string[] = [];
        const step = new DetectInstalledJdksStep({
            findRuntimes: async () => [jdk('/opt/jdk-17', 17)],
            readToolchainsJdks: () => [{jdkHome: '/opt/jdk-17'}],
            inspectJdk: async (jdkHome) => { inspected.push(jdkHome); return jdk(jdkHome, 17); },
        });

        await step.run(state);

        assert.deepEqual(inspected, []);
        assert.equal(state.detectedJdks.get('17'), '/opt/jdk-17');
    });

    it('leaves detection empty when no project requires a Java version', async () => {
        const state = createInitialState();
        const step = new DetectInstalledJdksStep({
            findRuntimes: async () => [jdk('/opt/jdk-17', 17)],
        });

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(state.detectedJdks.size, 0);
    });
});
