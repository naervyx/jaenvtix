import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ResolveProjectsStep} from '../../../src/configuration/steps/resolveProjectsStep';
import {createInitialState} from '../../../src/core/types';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

describe('ResolveProjectsStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function workspaceWith(files: {path: string; content: string}[]): Promise<string> {
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        for (const f of files) {
            const target = join(root, f.path);
            await fs.mkdir(join(target, '..'), {recursive: true});
            await fs.writeFile(target, f.content);
        }
        return root;
    }

    it('errors when state has no workspace folders', async () => {
        const result = await new ResolveProjectsStep().run(createInitialState());
        assert.equal(result.kind, 'error');
    });

    it('warns when no pom.xml is found in any workspace', async () => {
        const root = await workspaceWith([{path: 'src/Main.java', content: ''}]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /pom/i);
    });

    it('warns when poms exist but none declare a Java version', async () => {
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><artifactId>x</artifactId></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /java version/i);
    });

    it('groups projects by detected Java version', async () => {
        const root = await workspaceWith([
            {path: 'service-a/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
            {path: 'service-b/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
            {path: 'service-c/pom.xml', content: '<project><properties><java.version>21</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);

        assert.equal(result.success, true);
        assert.equal(state.projectVersionMap.size, 2);
        assert.equal(state.projectVersionMap.get('17')?.length, 2);
        assert.equal(state.projectVersionMap.get('21')?.length, 1);
    });

    it('clears any pre-existing projectVersionMap before populating', async () => {
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><properties><java.version>21</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];
        state.projectVersionMap.set('stale', ['/stale']);

        await new ResolveProjectsStep().run(state);

        assert.equal(state.projectVersionMap.has('stale'), false);
    });

    it('skips poms whose Java version cannot be parsed but keeps the run successful if any other does parse', async () => {
        const root = await workspaceWith([
            {path: 'a/pom.xml', content: '<project><artifactId>no-version</artifactId></project>'},
            {path: 'b/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);

        assert.equal(result.success, true);
        assert.equal(state.projectVersionMap.size, 1);
        assert.equal(state.projectVersionMap.get('17')?.length, 1);
    });
});
