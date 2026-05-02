import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {PrepareVersionPathsStep} from '../../../src/configuration/steps/prepareVersionPathsStep';
import {createInitialState} from '../../../src/core/types';

describe('PrepareVersionPathsStep', () => {
    it('builds a VersionPath entry for every key in projectVersionMap', async () => {
        const state = createInitialState();
        state.projectVersionMap.set('17', ['/projects/a']);
        state.projectVersionMap.set('21', ['/projects/b', '/projects/c']);

        const result = await new PrepareVersionPathsStep().run(state);

        assert.equal(result.success, true);
        assert.equal(state.versionPaths.size, 2);
        const v17 = state.versionPaths.get('17');
        assert.ok(v17);
        assert.match(v17?.jdkHome ?? '', /jdk-17$/);
        assert.match(v17?.toolHome ?? '', /jdk-17[\\/]+mvn-custom$/);
        assert.match(v17?.toolBin ?? '', /mvn-custom[\\/]+bin$/);
    });

    it('clears any existing versionPaths before rebuilding', async () => {
        const state = createInitialState();
        state.versionPaths.set('stale', {jdkHome: '/old', toolHome: '/old', toolBin: '/old'});
        state.projectVersionMap.set('17', ['/p']);

        await new PrepareVersionPathsStep().run(state);

        assert.equal(state.versionPaths.has('stale'), false);
        assert.equal(state.versionPaths.has('17'), true);
    });

    it('is a no-op when projectVersionMap is empty', async () => {
        const state = createInitialState();
        const result = await new PrepareVersionPathsStep().run(state);
        assert.equal(result.success, true);
        assert.equal(state.versionPaths.size, 0);
    });

    // Business rule: when an installed JDK was detected for a given version,
    // the resulting `jdkHome` must point at that external installation —
    // not at the Jaenvtix download cache slot. This is what skips the download.
    it('reuses a detected JDK as jdkHome when one was registered for the version', async () => {
        const state = createInitialState();
        state.projectVersionMap.set('17', ['/projects/a']);
        state.detectedJdks.set('17', '/usr/lib/jvm/jdk-17');

        await new PrepareVersionPathsStep().run(state);

        const v17 = state.versionPaths.get('17');
        assert.equal(v17?.jdkHome, '/usr/lib/jvm/jdk-17');
    });

    // Business rule: even when the JDK comes from outside Jaenvtix's cache,
    // Maven still lives inside the cache slot. Jaenvtix owns Maven entirely
    // (wrapper script, settings.xml enforcement) and does not reuse a system
    // Maven, so the tool paths must remain anchored to ~/.jaenvtix/.
    it('keeps toolHome/toolBin anchored to the Jaenvtix cache even when the JDK is external', async () => {
        const state = createInitialState();
        state.projectVersionMap.set('17', ['/projects/a']);
        state.detectedJdks.set('17', '/usr/lib/jvm/jdk-17');

        await new PrepareVersionPathsStep().run(state);

        const v17 = state.versionPaths.get('17');
        assert.match(v17?.toolHome ?? '', /jdk-17[\\/]+mvn-custom$/);
        assert.match(v17?.toolBin ?? '', /mvn-custom[\\/]+bin$/);
    });
});
