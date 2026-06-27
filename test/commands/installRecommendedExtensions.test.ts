import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    InstallRecommendedExtensionsDeps,
    runInstallRecommendedExtensionsCommand,
} from '../../src/commands/installRecommendedExtensions';
import type {RecommendedExtensionPickItem} from '../../src/build/recommendedExtensions';

interface FakeDepsOptions {
    installedIds?: string[];
    /** Maps the shown QuickPick items to the user's selection. `undefined` = cancel. */
    select?: (items: RecommendedExtensionPickItem[]) => RecommendedExtensionPickItem[] | undefined;
    failingIds?: string[];
    infoAnswer?: string;
}

function makeDeps(options: FakeDepsOptions = {}): {
    deps: InstallRecommendedExtensionsDeps;
    installed: string[];
    errors: string[];
    infos: string[];
    reloads: number;
} {
    const installed: string[] = [];
    const errors: string[] = [];
    const infos: string[] = [];
    const state = {reloads: 0};
    const deps: InstallRecommendedExtensionsDeps = {
        isExtensionInstalled: (id) => (options.installedIds ?? []).includes(id),
        showQuickPick: async (items) => (options.select ?? ((all) => all))(items),
        withProgress: async (_title, task) => task(() => undefined),
        installExtension: async (id) => {
            if ((options.failingIds ?? []).includes(id)) {
                throw new Error(`marketplace unreachable for ${id}`);
            }
            installed.push(id);
        },
        showInformationMessage: async (message) => {
            infos.push(message);
            return options.infoAnswer;
        },
        showErrorMessage: (message) => { errors.push(message); },
        reloadWindow: async () => { state.reloads += 1; },
    };
    return {deps, installed, errors, infos, get reloads() { return state.reloads; }};
}

describe('runInstallRecommendedExtensionsCommand', () => {
    it('installs all 3 extensions when none is installed and the user confirms all', async () => {
        const fake = makeDeps();
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 3);
        assert.equal(fake.errors.length, 0);
    });

    it('skips an already-installed extension even when the user selects it', async () => {
        const fake = makeDeps({installedIds: ['vscjava.vscode-java-pack']});
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 2);
        assert.ok(!fake.installed.includes('vscjava.vscode-java-pack'));
    });

    it('installs nothing when the user cancels the QuickPick', async () => {
        const fake = makeDeps({select: () => undefined});
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 0);
        assert.equal(fake.infos.length, 0);
        assert.equal(fake.errors.length, 0);
    });

    it('reports "already installed" when the selection contains only installed extensions', async () => {
        const fake = makeDeps({
            installedIds: ['vscjava.vscode-java-pack'],
            select: (items) => items.filter((item) => item.isInstalled),
        });
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 0);
        assert.deepEqual(fake.infos, ['All selected extensions are already installed.']);
    });

    it('continues installing the remaining extensions when one fails', async () => {
        const fake = makeDeps({failingIds: ['vmware.vscode-boot-dev-pack']});
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 2);
        assert.equal(fake.errors.length, 1);
        assert.match(fake.errors[0] ?? '', /Failed to install Spring Boot Extension Pack/);
    });

    it('reloads the window when the user accepts the post-install prompt', async () => {
        const fake = makeDeps({infoAnswer: 'Reload Now'});
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.reloads, 1);
    });

    it('does not offer a reload when every installation failed', async () => {
        const fake = makeDeps({
            failingIds: [
                'vscjava.vscode-java-pack',
                'vmware.vscode-boot-dev-pack',
                'redhat.vscode-xml',
            ],
        });
        await runInstallRecommendedExtensionsCommand(fake.deps);

        assert.equal(fake.installed.length, 0);
        assert.equal(fake.infos.length, 0);
        assert.equal(fake.errors.length, 3);
    });
});
