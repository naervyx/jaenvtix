import {
    buildRecommendedExtensionPickItems,
    RecommendedExtensionPickItem,
} from '../build/recommendedExtensions';
import {Messages} from '../util/message';

/**
 * Minimal surface of the VS Code APIs the command needs. `extension.ts`
 * injects the real implementations; tests inject in-memory fakes so the
 * module never imports `vscode` and stays loadable under plain Node.
 */
export interface InstallRecommendedExtensionsDeps {
    isExtensionInstalled(extensionId: string): boolean;
    showQuickPick(
        items: RecommendedExtensionPickItem[],
        options: {canPickMany: true; placeHolder: string; title: string},
    ): Thenable<RecommendedExtensionPickItem[] | undefined>;
    /** Wraps `task` in a progress notification; `report` updates the message. */
    withProgress(title: string, task: (report: (message: string) => void) => Promise<void>): Thenable<void>;
    /** Runs `workbench.extensions.installExtension` for the given ID. */
    installExtension(extensionId: string): Thenable<void>;
    showInformationMessage(message: string, ...actions: string[]): Thenable<string | undefined>;
    showErrorMessage(message: string): void;
    reloadWindow(): Thenable<void>;
}

/**
 * Entry point for the `jaenvtix.installRecommendedExtensions` command.
 *
 * Business rules:
 * - Strictly opt-in: only runs when invoked from the Command Palette; never
 *   force-installs anything at activation time.
 * - Already-installed extensions are never reinstalled, even when the user
 *   leaves them selected.
 * - A failed installation surfaces an error toast but does not abort the
 *   remaining installations.
 * - After at least one successful install, offers a window reload so the new
 *   extensions activate.
 */
export async function runInstallRecommendedExtensionsCommand(
    deps: InstallRecommendedExtensionsDeps,
): Promise<void> {
    const items = buildRecommendedExtensionPickItems(deps.isExtensionInstalled);

    const selected = await deps.showQuickPick(items, {
        canPickMany: true,
        placeHolder: Messages.Picker.RECOMMENDED_PLACEHOLDER,
        title: Messages.Picker.RECOMMENDED_TITLE,
    });

    if (!selected || selected.length === 0) {
        return;
    }

    const toInstall = selected.filter((item) => !item.isInstalled);
    if (toInstall.length === 0) {
        await deps.showInformationMessage(Messages.Info.ALL_SELECTED_EXTENSIONS_INSTALLED);
        return;
    }

    let installedCount = 0;
    await deps.withProgress(Messages.Progress.INSTALL_EXTENSIONS_TITLE, async (report) => {
        for (const [index, item] of toInstall.entries()) {
            report(`${item.label} (${index + 1}/${toInstall.length})`);
            try {
                await deps.installExtension(item.extensionId);
                installedCount += 1;
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                deps.showErrorMessage(Messages.Error.EXTENSION_INSTALL_FAILED(item.label, detail));
            }
        }
    });

    if (installedCount === 0) {
        return;
    }

    const action = await deps.showInformationMessage(
        Messages.Info.EXTENSIONS_INSTALLED(installedCount),
        Messages.Choice.RELOAD_NOW,
    );
    if (action === Messages.Choice.RELOAD_NOW) {
        await deps.reloadWindow();
    }
}
