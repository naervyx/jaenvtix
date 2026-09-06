import * as vscode from 'vscode';

import {runConfigureJavaCommand} from './configuration/configureJavaCommand';
import {createMismatchMemento} from './configuration/mismatchMemento';
import {runInstallRecommendedExtensionsCommand} from './commands/installRecommendedExtensions';
import {
    AUTO_CONFIG_GENERATION_KEY,
    AUTO_CONFIG_RECORD_KEY,
    AutoConfigAnswer,
    decideAutoConfigAction,
    normalizeGeneration,
    normalizeRecord,
} from './activation/autoConfigPrompt';
import {isWorkspaceConfigured} from './activation/workspaceConfigured';
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
 * called. Multi-root workspaces and the `workspaceContains` activation
 * events can re-trigger activation per folder; without this guard, the
 * user would see N prompts for an N-folder workspace.
 *
 * Reset on a new VS Code session because the module reloads.
 */
let autoConfigDelivered = false;

/**
 * VS Code extension activation entry point. Called once per extension host when
 * a `pom.xml` is detected in the workspace (`workspaceContains` activation event).
 *
 * Business rules:
 * - Registers three commands:
 *   - `jaenvtix.configureJava`: runs the full configuration pipeline.
 *   - `jaenvtix.resetAutoConfigPreference`: forgets this workspace's answer and
 *     invalidates the answers recorded in every other one, so all of them ask
 *     again.
 *   - `jaenvtix.installRecommendedExtensions`: the opt-in catalogue picker.
 * - Calls `offerAutoConfigIfNeeded` to handle the activation prompt; errors are
 *   swallowed so the extension remains usable via the Command Palette even if
 *   the prompt fails.
 */
export async function activate(context: vscode.ExtensionContext) {
    // Route Messages.Log lines to a user-visible output channel instead of
    // the extension-host console (only reachable through developer tools).
    const outputChannel = vscode.window.createOutputChannel('Jaenvtix');
    context.subscriptions.push(outputChannel);
    setLogSink((message) => outputChannel.appendLine(message));

    // First line in the channel, so "the host never activated us" is
    // distinguishable from "we activated and decided to stay quiet". Without
    // it, both look identical to a user: an empty channel and no prompt.
    log(Messages.Log.ACTIVATED(vscode.workspace.workspaceFolders?.length ?? 0));

    const configureJava = vscode.commands.registerCommand(
        CONFIGURE_JAVA_COMMAND,
        (options?: import('./configuration/configureJavaCommand').ConfigureJavaOptions) =>
            runConfigureJavaCommand(options, {
                // Only activate() sees the ExtensionContext; the pipeline gets
                // a narrow accessor to the workspace-scoped mismatch backlog.
                mismatchMemento: createMismatchMemento(context.workspaceState),
                showLogs: () => outputChannel.show(true),
                // Every successful run records acceptance, whoever started it.
                // A run from the Command Palette is as explicit an intention as
                // clicking Yes, and it converts a previous "No": without that,
                // configuring by hand would still be followed by a prompt on
                // the next open.
                recordConfigured: (settingsPaths) => rememberAnswer(context, 'accepted', settingsPaths),
            }),
    );
    context.subscriptions.push(configureJava);

    const resetAutoConfig = vscode.commands.registerCommand(
        RESET_AUTO_CONFIG_PREFERENCE_COMMAND,
        async () => {
            // Clear both layers so the next open re-prompts EVERYWHERE:
            // - workspaceState: this workspace's answer, removed outright
            // - globalState generation: bumped, which invalidates the answers
            //   recorded in every OTHER workspace. There is no API to reach
            //   those rows, and clearing only the current one is what made the
            //   stale state feel impossible to get rid of.
            await context.workspaceState.update(AUTO_CONFIG_RECORD_KEY, undefined);
            await context.globalState.update(
                AUTO_CONFIG_GENERATION_KEY,
                normalizeGeneration(context.globalState.get(AUTO_CONFIG_GENERATION_KEY)) + 1,
            );
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
 * is not ready yet.
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
 * Which of the three silences this was, in the words of its own remedy. A user
 * who sees no prompt has one place to look, and it has to answer "why" rather
 * than just "something was skipped".
 */
function skipReason(
    folders: readonly vscode.WorkspaceFolder[] | undefined,
    rawRecord: unknown,
): string {
    if (!folders || folders.length === 0) {
        return Messages.Log.AUTO_CONFIG_SKIPPED_NO_FOLDERS;
    }
    return normalizeRecord(rawRecord)?.answer === 'declined'
        ? Messages.Log.AUTO_CONFIG_SKIPPED_DECLINED
        : Messages.Log.AUTO_CONFIG_SKIPPED_CONFIGURED;
}

/**
 * Records what the user decided about this workspace, stamped with the reset
 * generation in force right now.
 *
 * `configured` is passed only by a successful run, and carries the
 * `settings.json` of every project it configured. That list is what the next
 * activation checks to tell a configured workspace from one whose `.vscode`
 * was deleted. A "No" records no list, because nothing was written.
 */
async function rememberAnswer(
    context: vscode.ExtensionContext,
    answer: AutoConfigAnswer,
    configured?: string[],
): Promise<void> {
    await context.workspaceState.update(AUTO_CONFIG_RECORD_KEY, {
        answer,
        generation: normalizeGeneration(context.globalState.get(AUTO_CONFIG_GENERATION_KEY)),
        configured,
    });
}

/**
 * The `'prompt-install'` branch: offer to install Java language support and,
 * only when it becomes available, configure the workspace.
 *
 * Business rules:
 * - All or nothing. Configuration runs only on `'ready'`; anything else leaves
 *   the workspace untouched and tells the user why.
 * - Acceptance is persisted ONLY by a run that completes, through the
 *   command's `recordConfigured` dep. A failed install is an unfinished
 *   intention, so the next open asks again, the same rule the dismissed-with-X
 *   case already follows.
 */
async function offerInstallThenConfigure(context: vscode.ExtensionContext): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        Messages.Info.START_CONFIG_WITH_EXTENSIONS,
        Messages.Choice.INSTALL_AND_CONFIGURE,
        Messages.Choice.NO,
    );

    if (choice === Messages.Choice.NO) {
        await rememberAnswer(context, 'declined');
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

    // No rememberAnswer here: the command records acceptance itself, on
    // success and with the files it wrote.
    await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
}

/**
 * On activation (triggered by the `workspaceContains` events for any
 * pom.xml in the workspace), pick one of three paths:
 *
 *   1. Prompt: no decision yet for this workspace, language support present.
 *   2. Prompt-install: no decision yet and language support missing: offer to
 *      install it, and configure only if that succeeds.
 *   3. Skip: no folders, or the user already answered the question that
 *      applies here.
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
        const folders = vscode.workspace.workspaceFolders;
        const rawRecord = context.workspaceState.get<unknown>(AUTO_CONFIG_RECORD_KEY);
        const decision = decideAutoConfigAction(
            folders,
            rawRecord,
            isLanguageServerVisible(),
            isWorkspaceConfigured(
                normalizeRecord(rawRecord),
                (folders ?? []).map((folder) => folder.uri.fsPath),
            ),
            context.globalState.get(AUTO_CONFIG_GENERATION_KEY),
        );

        if (decision === 'skip') {
            // Three different states collapse into one decision and the remedy
            // differs for each, so the channel has to say which one it was.
            log(skipReason(folders, rawRecord));
            return;
        }

        if (decision === 'prompt-install') {
            await offerInstallThenConfigure(context);
            return;
        }

        // decision === 'prompt'
        const choice = await vscode.window.showInformationMessage(
            Messages.Info.START_CONFIG,
            Messages.Choice.YES,
            Messages.Choice.NO,
        );

        if (choice === Messages.Choice.YES) {
            // Acceptance is recorded by the command, on success and with the
            // files it wrote. Recording it here as well would mark the
            // workspace configured even when the run warned or failed.
            await vscode.commands.executeCommand(CONFIGURE_JAVA_COMMAND, {skipConfirmation: true});
            return;
        }

        if (choice === Messages.Choice.NO) {
            await rememberAnswer(context, 'declined');
        }
        // A `null`/`undefined` choice means the notification was dismissed
        // via the X button. We deliberately do NOT persist that; it's
        // ambiguous (user may have just been busy), so we re-ask next session.
    } catch (error) {
        // The output channel, not the extension-host console: a user who sees
        // no prompt can open the channel, but never the developer tools.
        const detail = error instanceof Error ? error.message : String(error);
        log(Messages.Log.AUTO_CONFIG_PROMPT_FAILED(detail));
    }
}
