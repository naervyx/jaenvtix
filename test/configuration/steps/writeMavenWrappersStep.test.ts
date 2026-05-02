import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {WriteMavenWrappersStep} from '../../../src/configuration/steps/writeMavenWrappersStep';
import {createInitialState} from '../../../src/core/types';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

describe('WriteMavenWrappersStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('errors when state.platform is missing', async () => {
        const state = createInitialState();
        const result = await new WriteMavenWrappersStep().run(state);
        assert.equal(result.kind, 'error');
    });

    it('writes one wrapper script per versionPath under linux', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));

        const v17Bin = join(root, 'jdk-17', 'mvn-custom', 'bin');
        const v21Bin = join(root, 'jdk-21', 'mvn-custom', 'bin');
        await fs.mkdir(v17Bin, {recursive: true});
        await fs.mkdir(v21Bin, {recursive: true});
        // The wrapper writer now requires the stock Maven binary to be present
        // (since Fatia 8 skips wrapper generation when no Maven is installed).
        await fs.writeFile(join(v17Bin, 'mvn'), '');
        await fs.writeFile(join(v21Bin, 'mvn'), '');

        const state = createInitialState();
        state.platform = 'linux';
        state.versionPaths.set('17', {
            jdkHome: join(root, 'jdk-17'),
            toolHome: join(root, 'jdk-17', 'mvn-custom'),
            toolBin: v17Bin,
        });
        state.versionPaths.set('21', {
            jdkHome: join(root, 'jdk-21'),
            toolHome: join(root, 'jdk-21', 'mvn-custom'),
            toolBin: v21Bin,
        });

        const result = await new WriteMavenWrappersStep().run(state);

        assert.equal(result.success, true);
        assert.ok(existsSync(join(v17Bin, 'jaenvtix-mvn')), 'unix wrapper for 17');
        assert.ok(existsSync(join(v21Bin, 'jaenvtix-mvn')), 'unix wrapper for 21');
    });

    it('writes a .cmd wrapper on windows', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));

        const binPath = join(root, 'jdk-17', 'mvn-custom', 'bin');
        await fs.mkdir(binPath, {recursive: true});
        await fs.writeFile(join(binPath, 'mvn.cmd'), '');

        const state = createInitialState();
        state.platform = 'windows';
        state.versionPaths.set('17', {
            jdkHome: join(root, 'jdk-17'),
            toolHome: join(root, 'jdk-17', 'mvn-custom'),
            toolBin: binPath,
        });

        await new WriteMavenWrappersStep().run(state);
        assert.ok(existsSync(join(binPath, 'jaenvtix-mvn.cmd')));
    });

    it('is a no-op when versionPaths is empty', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        const result = await new WriteMavenWrappersStep().run(state);
        assert.equal(result.success, true);
    });

    // Business rule: when ScheduleDownloadsStep skipped Maven (because every
    // project ships its own mvnw), the cache slot has no `mvn`/`mvn.cmd` and
    // generating a wrapper that points at it would create a broken file.
    // The wrapper step must skip those versions silently.
    it('skips versions where Maven was not installed (mvnw-only workspace)', async () => {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));

        const binPath = join(root, 'jdk-17', 'mvn-custom', 'bin');
        await fs.mkdir(binPath, {recursive: true});
        // No `mvn`/`mvn.cmd` written — this simulates the ScheduleDownloadsStep
        // having skipped the Maven download for an mvnw-only workspace.

        const state = createInitialState();
        state.platform = 'linux';
        state.versionPaths.set('17', {
            jdkHome: join(root, 'jdk-17'),
            toolHome: join(root, 'jdk-17', 'mvn-custom'),
            toolBin: binPath,
        });

        const result = await new WriteMavenWrappersStep().run(state);

        assert.equal(result.success, true);
        assert.equal(existsSync(join(binPath, 'jaenvtix-mvn')), false);
    });
});
