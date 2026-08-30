import * as vscode from 'vscode';

import {runConfigureJavaCommand} from './configuration/configureJavaCommand';
import {createMismatchMemento} from './configuration/mismatchMemento';
import {runInstallRecommendedExtensionsCommand} from './commands/installRecommendedExtensions';
import {
    AUTO_CONFIG_ALWAYS_KEY,
    AUTO_CONFIG_DISMISSED_KEY,
    decideAutoConfigAction,
} from './activation/autoConfigPrompt';
import {Messages} from './util/message';
import {setLogSink} from './util/logger';

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

/**
 * On activation (triggered by the `workspaceContains` event for any
 * pom.xml in the workspace), decide between three paths:
 *
 *   1. Auto-run (silent): when the user has previously chosen "Always".
 *   2. Prompt: when no decision has been made for this workspace yet.
 *   3. Skip: when the user already answered Yes/No for this workspace.
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
        );

        if (decision === 'skip') {
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
        // via the X button. We deliberately do NOT persist that; it's
        // ambiguous (user may have just been busy), so we re-ask next session.
    } catch (error) {
        console.warn('[jaenvtix] Auto-config prompt failed:', error);
    }
}
