import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {RecommendExtensionsStep} from '../../../src/configuration/steps/recommendExtensionsStep';
import {RECOMMENDED_EXTENSIONS} from '../../../src/build/recommendedExtensions';
import {createInitialState, ProjectContext} from '../../../src/core/types';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

function buildContext(workspace: string, projectPath: string): ProjectContext {
    return {
        workspace,
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

describe('RecommendExtensionsStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('writes extensions.json once per workspace root, not per module', async () => {
        const workspace = await createTempDir();
        cleanups.push(() => removeTempDir(workspace));

        const state = createInitialState();
        state.projectContexts.push(
            buildContext(workspace, workspace),
            buildContext(workspace, join(workspace, 'module-a')),
            buildContext(workspace, join(workspace, 'module-b')),
        );

        const result = await new RecommendExtensionsStep().run(state);

        assert.equal(result.success, true);
        const rootFile = JSON.parse(
            await fs.readFile(join(workspace, '.vscode', 'extensions.json'), 'utf-8'),
        ) as {recommendations: string[]};
        assert.deepEqual(rootFile.recommendations, RECOMMENDED_EXTENSIONS.map((e) => e.id));

        // Nested modules must NOT receive their own extensions.json.
        await assert.rejects(fs.access(join(workspace, 'module-a', '.vscode', 'extensions.json')));
    });

    it('succeeds and writes nothing when there are no project contexts', async () => {
        const result = await new RecommendExtensionsStep().run(createInitialState());
        assert.equal(result.success, true);
    });
});
