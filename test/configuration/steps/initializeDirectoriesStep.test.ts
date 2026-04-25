import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {InitializeDirectoriesStep} from '../../../src/configuration/steps/initializeDirectoriesStep';
import {createInitialState} from '../../../src/core/types';

describe('InitializeDirectoriesStep', () => {
    it('returns success and is a no-op against state', async () => {
        // The step delegates to initializeBaseDirectories(), which mkdirs
        // ~/.jaenvtix/{,temp}. Calling it twice is safe by design (mkdirSync
        // recursive). Here we just assert the step contract: it returns
        // success and does not mutate the configuration state.
        const state = createInitialState();
        const before = JSON.stringify({
            workspaceFolders: state.workspaceFolders,
            projectVersionMap: [...state.projectVersionMap.entries()],
            versionPaths: [...state.versionPaths.entries()],
            projectContexts: state.projectContexts,
        });

        const result = await new InitializeDirectoriesStep().run(state);
        assert.equal(result.success, true);

        const after = JSON.stringify({
            workspaceFolders: state.workspaceFolders,
            projectVersionMap: [...state.projectVersionMap.entries()],
            versionPaths: [...state.versionPaths.entries()],
            projectContexts: state.projectContexts,
        });
        assert.equal(after, before);
    });
});
