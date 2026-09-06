import * as vscode from 'vscode';

import {runConfigureJavaCommand} from './configuration/configureJavaCommand';
import {createMismatchMemento} from './configuration/mismatchMemento';
import {runInstallRecommendedExtensionsCommand} from './commands/installRecommendedExtensions';
import {
    AUTO_CONFIG_ALWAYS_KEY,
    AUTO_CONFIG_DISMISSED_KEY,
    decideAutoConfigAction,
} from './activation/autoConfigPrompt';
import {
    installLanguageSupport,
    JAVA_EXTENSION_PACK_ID,
    JAVA_LANGUAGE_SERVER_ID,
} from './activation/installLanguageSupport';
import {Messages} from './util/message';
import {log, setLogSink} from './util/logger';

const CONFIGURE_JAVA_COMMAND = 'jaenvtix.configureJava';
const RESET_AUTO_CONFIG_PREFERENCE_COMMAND = 'jaenvtix.resetAutoConfigPreference';
const INSTALL_RECOMMENDED_EXTENSIONS_COMMAND = 'jaenvtix.installRecommendedExtensions';

/**
 * Module-level guard so the auto-config prompt fires AT MOST ONCE per
 * extension host lifetime, regardless of how many times `activate()` is
 * called. Multi-root workspaces and `workspaceContains:**` activation
 * events can re-trigger activation per folder; without this guard, the
 * user would see N prompts (or N silent runs) for an N-folder workspace.
 *
 * Reset on a new VS Code session because the module reloads.
 */
let autoConfigDelivered = false;

/**
 * VS Code extension activation entry point. Called once per extension host when
 * a `pom.xml` is detected in the workspace (`workspaceContains` activation event).
 *
 * Business rules:
 * - Registers two commands:
 *   - `jaenvtix.configureJava`: runs the full configuration pipeline.
 *   - `jaenvtix.resetAutoConfigPreference`: clears both the per-workspace and the
 *     global "Always" preference so the user is prompted again.
 * - Calls `offerAutoConfigIfNeeded` to handle the auto-config prompt or silent
 *   run; errors are swallowed so the extension remains usable via the Command
 *   Palette even if the activation-time prompt fails.
 */
export async function activate(context: vscode.ExtensionContext) {
    // Route Messages.Log lines to a user-visible output channel instead of
    // the extension-host console (only reachable through developer tools).
    const outputChannel = vscode.window.createOutputChannel('Jaenvtix');
    context.subscriptions.push(outputChannel);
    setLogSink((message) => outputChannel.appendLine(message));

    const configureJava = vscode.commands.registerCommand(
        CONFIGURE_JAVA_COMMAND,
        (options?: import('./configuration/configureJavaCommand').ConfigureJavaOptions) =>
            runConfigureJavaCommand(options, {
                // Only activate() sees the ExtensionContext; the pipeline gets
                // a narrow accessor to the workspace-scoped mismatch backlog.
                mismatchMemento: createMismatchMemento(context.workspaceState),
                showLogs: () => outputChannel.show(true),
            }),
    );
    context.subscriptions.push(configureJava);

    const resetAutoConfig = vscode.commands.registerCommand(
        RESET_AUTO_CONFIG_PREFERENCE_COMMAND,
        async () => {
            // Clear both layers so the next workspace open re-prompts:
            // - workspaceState: per-workspace Yes/No answer
            // - globalState: cross-workspace "Always" preference
            await context.workspaceState.update(AUTO_CONFIG_DISMISSED_KEY, undefined);
            await context.globalState.update(AUTO_CONFIG_ALWAYS_KEY, undefined);
            // Reset the in-memory guard so a Reload Window in this same
            // host instance is enough to see the prompt again.
            autoConfigDelivered = false;
            void vscode.window.showInformationMessage(Messages.Info.AUTO_CONFIG_PREFERENCE_RESET);
        },
    );
    context.subscriptions.push(resetAutoConfig);

    const installRecommendedExtensions = vscode.commands.registerCommand(
        INSTALL_RECOMMENDED_EXTENSIONS_COMMAND,
        () => runInstallRecommendedExtensionsCommand({
            isExtensionInstalled: (extensionId) => vscode.extensions.getExtension(extensionId) !== undefined,
            showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
            withProgress: (title, task) => vscode.window.withProgress(
                {location: vscode.ProgressLocation.Notification, title, cancellable: false},
                (progress) => task((message) => progress.report({message})),
            ),
            installExtension: (extensionId) =>
                vscode.commands.executeCommand('workbench.extensions.installExtension', extensionId),
            showInformationMessage: (message, ...actions) =>
                vscode.window.showInformationMessage(message, ...actions),
            showErrorMessage: (message) => void vscode.window.showErrorMessage(message),
            reloadWindow: () => vscode.commands.executeCommand('workbench.action.reloadWindow'),
        }),
    );
    context.subscriptions.push(installRecommendedExtensions);

    void offerAutoConfigIfNeeded(context);
}

/** True when the Red Hat Java extension is visible to the extension host. */
function isLanguageServerVisible(): boolean {
    return vscode.extensions.getExtension(JAVA_LANGUAGE_SERVER_ID) !== undefined;
}

/**
 * Resolves on the next extension-host change, or after `ms` elapse, whichever
 * comes first. Used as a safety net while waiting for a freshly installed
 * extension to be published.
 */
function waitForExtensionChange(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const subscription = vscode.extensions.onDidChange(() => {
            clearTimeout(timer);
            subscription.dispose();
            resolve();
        });
        const timer = setTimeout(() => {
            subscription.dispose();
            resolve();
        }, ms);
    });
}

/**
 * Opens the extension's page so the user can install or enable it by hand.
 *
 * Uses `env.openExternal` with the host's own URI scheme rather than an
 * internal command: it is public API, it reports success, and reading the
 * scheme from `env.uriScheme` keeps it working on forks (measured `cursor` on
 * Cursor, where a hardcoded `vscode:` would have failed).
 */
async function showLanguageServerExtensionPage(): Promise<void> {
    const uri = vscode.Uri.parse(`${vscode.env.uriScheme}:extension/${JAVA_LANGUAGE_SERVER_ID}`);
    try {
        const opened = await vscode.env.openExternal(uri);
        if (!opened) {
            log(Messages.Log.EXTENSION_PAGE_NOT_OPENED(JAVA_LANGUAGE_SERVER_ID));
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(Messages.Log.EXTENSION_PAGE_NOT_OPENED(`${JAVA_LANGUAGE_SERVER_ID} (${detail})`));
    }
}

/**
 * Told the user nothing was configured, and offers the two things that can fix
 * it. Deliberately a warning and not an error: nothing broke, the environment
 * is simply not ready yet.
 */
function notifyLanguageSupportUnavailable(): void {
    void vscode.window.showWarningMessage(
        Messages.Warning.CONFIG_SKIPPED_NO_LANGUAGE_SUPPORT,
        Messages.Choice.RELOAD_NOW,
        Messages.Choice.SHOW_EXTENSION,
    ).then((choice) => {
        if (choice === Messages.Choice.RELOAD_NOW) {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else if (choice === Messages.Choice.SHOW_EXTENSION) {
            void showLanguageServerExtensionPage();
        }
    });
}

/**
 * The `'prompt-install'` branch: offer to install Java language support and,
 * only when it becomes available, configure the workspace.
 *
 * Business rules:
 * - All or nothing. Configuration runs only on `'ready'`; anything else leaves
 *   the workspace untouched and tells the user why.
 * - The per-workspace answer is persisted ONLY when the flow completes. A
 *   failed install is an unfinished intention, so the next open asks again,
 *   the same rule the dismissed-with-X case already follows.
 */
async function offerInstallThenConfigure(context: vscode.ExtensionContext): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        Messages.Info.START_CONFIG_WITH_EXTENSIONS,
        Messages.Choice.INSTALL_AND_CONFIGURE,
        Messages.Choice.NO,
    );

    if (choice === Messages.Choice.NO) {
        await context.workspaceState.update(AUTO_CONFIG_DISMISSED_KEY, true);
        return;
    }

    if (choice !== Messages.Choice.INSTALL_AND_CONFIGURE) {
        // Dismissed with the X: ambiguous, so ask again next session.
        return;
    }

    const outcome = await installLanguageSupport({
        isLanguageServerVisible,
        installExtensionPack: () =>
            vscode.commands.executeCommand('workbench.extensions.installExtension', JAVA_EXTENSION_PACK_ID),
        withProgress: (title, task) => vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, title, cancellable: false},
            () => task(),
        ),
        waitForExtensionChange,
    });

    if (outcome === 'unavailable') {
        notifyLanguageSupportUnavailable();
        return;
    }

    await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
    await context.workspaceState.update(AUTO_CONFIG_DISMISSED_KEY, true);
}

/**
 * On activation (triggered by the `workspaceContains` event for any
 * pom.xml in the workspace), pick one of five paths:
 *
 *   1. Auto-run (silent) — "Always" was chosen and language support is present.
 *   2. Prompt — no decision yet for this workspace, language support present.
 *   3. Prompt-install — no decision yet and language support missing: offer to
 *      install it, and configure only if that succeeds.
 *   4. Skip, logged — "Always" was chosen but language support is missing, so
 *      there is nothing to consume what would be written and the silence the
 *      user asked for is kept.
 *   5. Skip — no folders, or the user already answered Yes/No here.
 *
 * Errors are swallowed: failing to show the prompt or run the command
 * must never block the extension from being usable via the Command
 * Palette.
 */
async function offerAutoConfigIfNeeded(context: vscode.ExtensionContext): Promise<void> {
    if (autoConfigDelivered) {
        return;
    }
    autoConfigDelivered = true;

    try {
        const workspaceDismissed = context.workspaceState.get<boolean>(AUTO_CONFIG_DISMISSED_KEY);
        const alwaysAccepted = context.globalState.get<boolean>(AUTO_CONFIG_ALWAYS_KEY);
        const decision = decideAutoConfigAction(
            vscode.workspace.workspaceFolders,
            workspaceDismissed,
            alwaysAccepted,
            isLanguageServerVisible(),
        );

        if (decision === 'skip') {
            return;
        }

        if (decision === 'skip-no-language-support') {
            log(Messages.Log.LANGUAGE_SERVER_ABSENT_AUTO_RUN(JAVA_LANGUAGE_SERVER_ID));
            return;
        }

        if (decision === 'prompt-install') {
            await offerInstallThenConfigure(context);
            return;
        }

        if (decision === 'auto-run') {
            await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
            return;
        }

        // decision === 'prompt'
        const choice = await vscode.window.showInformationMessage(
            Messages.Info.START_CONFIG,
            Messages.Choice.YES,
            Messages.Choice.ALWAYS,
            Messages.Choice.NO,
        );

        if (choice === Messages.Choice.ALWAYS) {
            await context.globalState.update(AUTO_CONFIG_ALWAYS_KEY, true);
            await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
            return;
        }

        if (choice === Messages.Choice.YES) {
            await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
        }

        // Persist BOTH explicit per-workspace answers ("Yes" → already ran,
        // "No" → user opted out). The Command Palette stays available either
        // way for re-runs.
        if (choice === Messages.Choice.YES || choice === Messages.Choice.NO) {
            await context.workspaceState.update(AUTO_CONFIG_DISMISSED_KEY, true);
        }
        // A `null`/`undefined` choice means the notification was dismissed
        // via the X button. We deliberately do NOT persist that — it's
        // ambiguous (user may have just been busy), so we re-ask next session.
    } catch (error) {
        console.warn('[jaenvtix] Auto-config prompt failed:', error);
    }
}
