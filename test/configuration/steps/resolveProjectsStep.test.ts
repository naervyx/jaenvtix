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

    it('records the Maven version pinned by each pom (isolated Maven on by default)', async () => {
        const root = await workspaceWith([
            {path: 'legacy/pom.xml', content: '<project><properties><java.version>21</java.version></properties><prerequisites><maven>3.6.3</maven></prerequisites></project>'},
            {path: 'modern/pom.xml', content: '<project><properties><java.version>21</java.version><maven.version>3.9.5</maven.version></properties></project>'},
            {path: 'plain/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);

        assert.equal(result.success, true);
        assert.equal(state.projectMavenVersions.get(join(root, 'legacy')), '3.6.3');
        assert.equal(state.projectMavenVersions.get(join(root, 'modern')), '3.9.5');
        assert.equal(state.projectMavenVersions.has(join(root, 'plain')), false);
    });

    it('skips pom inspection when jaenvtix.isolatedMavenPerProject is false', async () => {
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><properties><java.version>21</java.version></properties><prerequisites><maven>3.6.3</maven></prerequisites></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        await new ResolveProjectsStep({isIsolatedMavenEnabled: () => false}).run(state);

        assert.equal(state.projectMavenVersions.size, 0);
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

    // Business rule: detect mvnw once during project resolution so downstream
    // steps (download scheduling, wrapper writing, project context building)
    // can read the result without redundant filesystem hits.
    it('records hasMvnw per project: true when mvnw/mvnw.cmd exists, false otherwise', async () => {
        const root = await workspaceWith([
            {path: 'with-wrapper/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
            {path: 'with-wrapper/mvnw', content: '#!/bin/sh\nexit 0'},
            {path: 'plain/pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        await new ResolveProjectsStep().run(state);

        assert.equal(state.projectsHasMvnw.get(join(root, 'with-wrapper')), true);
        assert.equal(state.projectsHasMvnw.get(join(root, 'plain')), false);
    });

    // Business rule: in a Maven monorepo where only the parent pom declares
    // `<java.version>` (Spring Boot is a typical case), the child modules
    // must NOT be silently dropped. Jaenvtix inherits the version from the
    // closest ancestor pom that lives in the same workspace.

    it('inherits the Java version from the parent pom when a child module does not declare its own', async () => {
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
            {path: 'module-a/pom.xml', content: '<project><artifactId>a</artifactId></project>'},
            {path: 'module-b/pom.xml', content: '<project><artifactId>b</artifactId></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);

        assert.equal(result.success, true);
        const v17 = state.projectVersionMap.get('17') ?? [];
        // Parent + 2 modules all resolved under JavaSE-17
        assert.ok(v17.includes(root));
        assert.ok(v17.includes(join(root, 'module-a')));
        assert.ok(v17.includes(join(root, 'module-b')));
    });

    it('lets child modules override the parent version when they declare their own', async () => {
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><properties><java.version>17</java.version></properties></project>'},
            {path: 'legacy/pom.xml', content: '<project><properties><java.version>1.8</java.version></properties></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        await new ResolveProjectsStep().run(state);

        // The legacy module keeps its own 1.8; inheritance only fills gaps.
        assert.deepEqual(state.projectVersionMap.get('17') ?? [], [root]);
        assert.deepEqual(state.projectVersionMap.get('8') ?? [], [join(root, 'legacy')]);
    });

    it('still drops modules without a Java version when no ancestor in the workspace declares one', async () => {
        // The user opened only `module-a/` as a workspace folder; its parent
        // pom (which would declare the version) is not part of the workspace,
        // so there is nothing to inherit from.
        const root = await workspaceWith([
            {path: 'pom.xml', content: '<project><artifactId>orphan</artifactId></project>'},
        ]);
        const state = createInitialState();
        state.workspaceFolders = [root];

        const result = await new ResolveProjectsStep().run(state);

        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /java version/i);
    });
});
