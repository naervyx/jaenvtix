import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {isWorkspaceConfigured} from '../../src/activation/workspaceConfigured';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

// Business rules:
// - A recorded path list is the exact answer: every file must still exist.
//   One deleted .vscode means the workspace lost its configuration.
// - Without a list (legacy records, or a folder configured inside a multi-root
//   workspace and later opened on its own), fall back to probing each folder
//   root for a `jaenvtix.*` key in settings.json.
// - Unreadable or malformed settings count as not configured. Writing the file
//   again is the remedy, and the writers are non-destructive.
//
// Real filesystem against temp dirs, per the project convention.

async function writeSettings(root: string, contents: string): Promise<string> {
    const dir = join(root, '.vscode');
    await fs.mkdir(dir, {recursive: true});
    const settingsPath = join(dir, 'settings.json');
    await fs.writeFile(settingsPath, contents);
    return settingsPath;
}

describe('isWorkspaceConfigured with a recorded path list', () => {
    let root: string;
    let rootSettings: string;
    let moduleSettings: string;

    before(async () => {
        root = await createTempDir();
        rootSettings = await writeSettings(root, JSON.stringify({'jaenvtix.autoUpdatePatches': true}));
        const modulePath = join(root, 'module-a');
        await fs.mkdir(modulePath, {recursive: true});
        // Nested modules get java/maven keys but never `jaenvtix.*`, which is
        // exactly why the recorded list has to be the primary check.
        moduleSettings = await writeSettings(modulePath, JSON.stringify({'java.jdt.ls.java.home': '/jdk'}));
    });

    after(async () => await removeTempDir(root));

    it('is configured while every recorded file still exists', () => {
        const record = {answer: 'accepted' as const, generation: 0, configured: [rootSettings, moduleSettings]};
        assert.equal(isWorkspaceConfigured(record, [root]), true);
    });

    it('is not configured when a single recorded file is gone', async () => {
        // The monorepo case: only one module lost its .vscode.
        await fs.rm(moduleSettings);
        const record = {answer: 'accepted' as const, generation: 0, configured: [rootSettings, moduleSettings]};
        assert.equal(isWorkspaceConfigured(record, [root]), false);
        // And the root file alone still counts as configured, so the check is
        // about the recorded set and not about "any file exists".
        assert.equal(
            isWorkspaceConfigured({answer: 'accepted', generation: 0, configured: [rootSettings]}, [root]),
            true,
        );
    });

    it('does not fall back to the probe when a list is present', async () => {
        // The root carries a `jaenvtix.*` key, so a probe would say configured.
        // The recorded list must win, otherwise a deleted module goes unnoticed.
        const record = {answer: 'accepted' as const, generation: 0, configured: [join(root, 'gone', 'settings.json')]};
        assert.equal(isWorkspaceConfigured(record, [root]), false);
    });
});

describe('isWorkspaceConfigured falling back to the folder probe', () => {
    let configuredRoot: string;
    let bareRoot: string;

    before(async () => {
        configuredRoot = await createTempDir();
        await writeSettings(configuredRoot, JSON.stringify({'jaenvtix.preferredJdkVendor': 'auto'}));
        bareRoot = await createTempDir();
    });

    after(async () => {
        await removeTempDir(configuredRoot);
        await removeTempDir(bareRoot);
    });

    it('is configured when the folder root carries a jaenvtix key', () => {
        // A legacy record, and a folder opened standalone after being
        // configured inside a multi-root workspace, both land here.
        assert.equal(isWorkspaceConfigured(undefined, [configuredRoot]), true);
        assert.equal(isWorkspaceConfigured({answer: 'accepted', generation: 0}, [configuredRoot]), true);
    });

    it('is not configured when there is no .vscode at all', () => {
        assert.equal(isWorkspaceConfigured(undefined, [bareRoot]), false);
        assert.equal(isWorkspaceConfigured({answer: 'accepted', generation: 0}, [bareRoot]), false);
    });

    it('requires every folder of a multi-root workspace', () => {
        assert.equal(isWorkspaceConfigured(undefined, [configuredRoot, bareRoot]), false);
        assert.equal(isWorkspaceConfigured(undefined, [configuredRoot, configuredRoot]), true);
    });

    it('treats an empty recorded list as no list', () => {
        assert.equal(isWorkspaceConfigured({answer: 'accepted', generation: 0, configured: []}, [configuredRoot]), true);
        assert.equal(isWorkspaceConfigured({answer: 'accepted', generation: 0, configured: []}, [bareRoot]), false);
    });

    it('is not configured with no folders at all', () => {
        assert.equal(isWorkspaceConfigured(undefined, []), false);
    });
});

describe('isWorkspaceConfigured on settings it cannot use', () => {
    let root: string;

    before(async () => await (async () => { root = await createTempDir(); })());
    after(async () => await removeTempDir(root));

    it('does not count settings without any jaenvtix key', async () => {
        // A hand-written settings.json is not evidence that Jaenvtix ran.
        await writeSettings(root, JSON.stringify({'java.jdt.ls.java.home': '/jdk'}));
        assert.equal(isWorkspaceConfigured(undefined, [root]), false);
    });

    it('does not count malformed JSON', async () => {
        await writeSettings(root, '{ this is not json');
        assert.equal(isWorkspaceConfigured(undefined, [root]), false);
    });

    it('does not count a JSON file that is not an object', async () => {
        await writeSettings(root, '"a string"');
        assert.equal(isWorkspaceConfigured(undefined, [root]), false);
        await writeSettings(root, 'null');
        assert.equal(isWorkspaceConfigured(undefined, [root]), false);
    });
});
