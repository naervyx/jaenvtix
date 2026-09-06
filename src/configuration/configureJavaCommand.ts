import * as vscode from 'vscode';

import {buildVsCodeSettingPath} from '../build/directory';
import {ConfirmConfigurationStep} from './steps/confirmConfigurationStep';
import {ValidateEnvironmentStep} from './steps/validateEnvironmentStep';
import {ResolveProjectsStep} from './steps/resolveProjectsStep';
import {InitializeDirectoriesStep} from './steps/initializeDirectoriesStep';
import {DetectInstalledJdksStep} from './steps/detectInstalledJdksStep';
import {PrepareVersionPathsStep} from './steps/prepareVersionPathsStep';
import {ScheduleDownloadsStep} from './steps/scheduleDownloadsStep';
import {BuildProjectContextsStep} from './steps/buildProjectContextsStep';
import {ProcessDownloadsStep} from './steps/processDownloadsStep';
import {WriteMavenWrappersStep} from './steps/writeMavenWrappersStep';
import {WriteToolchainsStep} from './steps/writeToolchainsStep';
import {ConfigureSettingsStep} from './steps/configureSettingsStep';
import {ConfigureUserRuntimesDeps, ConfigureUserRuntimesStep} from './steps/configureUserRuntimesStep';
import {ApplyUserTuningsStep} from './steps/applyUserTuningsStep';
import {ConfigureOptionalExtensionsStep} from './steps/configureOptionalExtensionsStep';
import {ConfigureLaunchStep} from './steps/configureLaunchStep';
import {RecommendExtensionsStep} from './steps/recommendExtensionsStep';
import {AwaitLanguageServerStep} from './steps/awaitLanguageServerStep';
import {RefreshProjectConfigurationStep} from './steps/refreshProjectConfigurationStep';
import {VerifyConfigurationStep} from './steps/verifyConfigurationStep';
import {MismatchMementoAccessor} from './mismatchMemento';
import {ConfigurationStep, ConfigurationStepResult, createInitialState, JavaConfigurationState, JavaRuntime, StepResult} from '../core/types';
import {Messages} from '../util/message';
import {log} from '../util/logger';
import {runStep, runSteps} from './stepRunner';
import {getJdkDistribution, normalizeVendorPreference} from '../build/javaUrl';
import {readSupportedJavaVersions} from '../build/redhatRuntimeReader';
import {downloadFile} from '../file/fileDownload';

const REDHAT_JAVA_EXTENSION_ID = 'redhat.java';
const JAVA_PROJECT_CONFIGURATION_UPDATE = 'java.projectConfiguration.update';
// Public redhat.java command: restarts ONLY the Language Server (no window
// reload), which is what applies a changed java.jdt.ls.java.home.
const JAVA_SERVER_RESTART = 'java.server.restart';

/**
 * Activates the redhat.java extension (when installed) and resolves its
 * public API exports. Returns `undefined` when the extension is not
 * installed — the distinction lets steps skip Language-Server-dependent
 * work instead of issuing commands that can only fail.
 */
async function activateRedhatJavaApi(): Promise<unknown> {
    const extension = vscode.extensions.getExtension(REDHAT_JAVA_EXTENSION_ID);
    if (!extension) {
        return undefined;
    }

    return extension.activate();
}

/**
 * Reads JDT project settings (e.g. compiler compliance) through the
 * redhat.java extension API. Returns `undefined` when the API or its
 * `getProjectSettings` method is unavailable (extension missing, LightWeight
 * mode, or an API version that predates the method).
 */
async function readRedhatProjectSettings(
    projectPath: string,
    settingKeys: string[],
): Promise<Record<string, unknown> | undefined> {
    const api = await activateRedhatJavaApi() as {getProjectSettings?: unknown} | undefined;
    if (!api || typeof api.getProjectSettings !== 'function') {
        return undefined;
    }

    const getProjectSettings = api.getProjectSettings as
        (resourceUri: string, keys: string[]) => Promise<unknown>;
    const result = await getProjectSettings(vscode.Uri.file(projectPath).toString(), settingKeys);

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return result as Record<string, unknown>;
    }

    return undefined;
}

/** Clamps `jaenvtix.downloadMaxRetries` to the schema's 0..10 range. */
function readDownloadMaxRetries(): number {
    const raw = vscode.workspace.getConfiguration().get('jaenvtix.downloadMaxRetries');
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return 3;
    }
    return Math.min(10, Math.max(0, Math.floor(raw)));
}

/**
 * The configuration pipeline split into two phases:
 * - `preConfirm`: validation and project discovery steps that run before the
 *   user is asked to confirm. Cheap and fast; aborts early if the workspace
 *   is not a Java project or the environment is unsupported.
 * - `postConfirm`: download, extraction, and settings-writing steps that run
 *   after the user has confirmed (or when `skipConfirmation` is set). These
 *   steps are wrapped in a VS Code progress notification.
 */
export interface StepGroups {
    preConfirm: ConfigurationStep[];
    postConfirm: ConfigurationStep[];
}

export interface ConfigureJavaOptions {
    /**
     * When true, the in-pipeline `ConfirmConfigurationStep` is skipped because
     * the caller (e.g. the auto-config prompt at activation) has already asked
     * the user. Prevents the user from seeing the same "Configure Java/Maven?"
     * prompt twice in a row.
     */
    skipConfirmation?: boolean;
}

/**
 * Host services only `activate()` can provide (an `ExtensionContext` never
 * reaches this module). Threaded from `extension.ts` into the pipeline steps.
 */
export interface ConfigureJavaDeps {
    /** workspaceState-backed accessor for the verification mismatch backlog. */
    mismatchMemento: MismatchMementoAccessor;
    /** Reveals the "Jaenvtix" output channel (the mismatch toast's Show Logs action). */
    showLogs: () => void;
    /**
     * Reports the `settings.json` of every project this run configured, so
     * activation can tell later whether the workspace is still configured.
     *
     * Called only on success, and with every resolved project, not just the
     * ones whose contents changed: an idempotent re-run leaves the same files
     * in place and they are exactly what must still exist.
     */
    recordConfigured?: (settingsPaths: string[]) => void | Promise<void>;
}

/**
 * Safe stand-in used when the command is invoked without host wiring (only
 * possible in unforeseen re-entry paths): the pipeline still works, it just
 * loses backlog persistence and the Show Logs shortcut.
 */
const NOOP_DEPS: ConfigureJavaDeps = {
    mismatchMemento: {
        get: () => [],
        update: async () => { /* nowhere to persist without a workspaceState */ },
    },
    showLogs: () => { /* output channel unavailable */ },
};

/**
 * Builds the default two-phase step list for the `jaenvtix.configureJava` command.
 * The `preConfirm` list always includes validation and project resolution; the
 * `ConfirmConfigurationStep` is added only when `options.skipConfirmation` is not set.
 */
export function getDefaultStepGroups(
    workspaceFolders: readonly {uri: {fsPath: string}}[] | undefined,
    options: ConfigureJavaOptions = {},
    deps: ConfigureJavaDeps = NOOP_DEPS,
): StepGroups {
    const preConfirm: ConfigurationStep[] = [
        new ValidateEnvironmentStep(workspaceFolders),
        new ResolveProjectsStep({
            isIsolatedMavenEnabled: () =>
                vscode.workspace.getConfiguration().get('jaenvtix.isolatedMavenPerProject') !== false,
        }),
    ];
    if (!options.skipConfirmation) {
        preConfirm.push(new ConfirmConfigurationStep());
    }

    return {
        preConfirm,
        postConfirm: [
            new InitializeDirectoriesStep(),
            new DetectInstalledJdksStep({
                isToolchainsDiscoveryEnabled: () =>
                    vscode.workspace.getConfiguration().get('jaenvtix.discoverFromToolchainsXml') !== false,
            }),
            new PrepareVersionPathsStep(),
            new ScheduleDownloadsStep({
                // Read redhat.java's supported-versions enum and the vendor
                // preference at step run time so new Java LTS releases and
                // setting changes are honoured without a Jaenvtix release/reload.
                getJdkDistribution: (version, platform, arch) => getJdkDistribution(version, platform, arch, {
                    supportedVersions: readSupportedJavaVersions(
                        () => vscode.extensions.getExtension('redhat.java')?.packageJSON,
                    ),
                    preferredVendor: normalizeVendorPreference(
                        vscode.workspace.getConfiguration().get('jaenvtix.preferredJdkVendor'),
                    ),
                }),
                isAutoUpdateEnabled: () =>
                    vscode.workspace.getConfiguration().get('jaenvtix.autoUpdatePatches') !== false,
                downloadFile: (downloadOptions) => downloadFile({
                    ...downloadOptions,
                    maxRetries: readDownloadMaxRetries(),
                }),
            }),
            // ProcessDownloads normalizes each version's `jdkHome` to the real
            // Java home (macOS bundles extract as Contents/Home), so project
            // contexts must be built after it to copy the corrected path.
            new ProcessDownloadsStep(),
            new BuildProjectContextsStep(),
            new WriteMavenWrappersStep(),
            new WriteToolchainsStep(),
            // ConfigureLaunch runs BEFORE ConfigureSettings on purpose: it
            // resolves each project's main class and records the Spring Boot
            // detection on the contexts, which ConfigureSettings then uses to
            // seed Spring-specific Maven favorites.
            new ConfigureLaunchStep({
                notifyMalformed: (filePath) => {
                    void vscode.window.showWarningMessage(
                        Messages.Warning.LAUNCH_JSON_MALFORMED(filePath)
                    );
                },
            }),
            new ConfigureSettingsStep(),
            new ConfigureUserRuntimesStep(buildUserRuntimesDeps()),
            new ApplyUserTuningsStep(() => vscode.workspace.getConfiguration()),
            new ConfigureOptionalExtensionsStep(
                () => vscode.workspace.getConfiguration(),
                (extensionId) => vscode.extensions.getExtension(extensionId) !== undefined,
            ),
            new RecommendExtensionsStep(),
            new AwaitLanguageServerStep({
                resolveRedhatApi: activateRedhatJavaApi,
                getMismatchBacklog: () => deps.mismatchMemento.get(),
            }),
            buildRefreshStep(),
            buildVerifyStep(deps),
        ],
    };
}

function buildUserRuntimesDeps(): ConfigureUserRuntimesDeps {
    // Each closure re-reads the configuration so the step sees the settings as
    // they are when it runs, not as they were when the step list was built.
    const javaConfiguration = () => vscode.workspace.getConfiguration('java.configuration');
    return {
        readGlobalRuntimes: () => javaConfiguration().inspect<JavaRuntime[]>('runtimes')?.globalValue,
        isPathFixEnabled: () =>
            vscode.workspace.getConfiguration('jaenvtix').get<boolean>('enableRuntimePathFix', true),
        writeGlobalRuntimes: (runtimes) =>
            javaConfiguration().update('runtimes', runtimes, vscode.ConfigurationTarget.Global),
    };
}

function buildRefreshStep(): RefreshProjectConfigurationStep {
    return new RefreshProjectConfigurationStep({
        refreshProject: async (pomPath) => {
            await vscode.commands.executeCommand(
                JAVA_PROJECT_CONFIGURATION_UPDATE,
                vscode.Uri.file(pomPath),
            );
        },
    });
}

function buildVerifyStep(deps: ConfigureJavaDeps): VerifyConfigurationStep {
    return new VerifyConfigurationStep({
        readProjectSettings: readRedhatProjectSettings,
        notifyMismatch: (message) => notifyMismatchWithActions(message, deps.showLogs),
        updateMismatchMemento: (projectPaths) => deps.mismatchMemento.update(projectPaths),
    });
}

/**
 * Runs the Red Hat restart command, tolerating its absence.
 *
 * The command belongs to `redhat.java`, so `executeCommand` rejects with
 * "command not found" when that extension is gone. Both callers only offer the
 * button when the Language Server answered earlier in the run, but the user
 * can uninstall between the toast appearing and the click, and a bare `void`
 * on the rejected promise would surface as an unhandled rejection with no
 * trace of why nothing happened.
 */
function restartLanguageServer(): void {
    void Promise.resolve(vscode.commands.executeCommand(JAVA_SERVER_RESTART)).then(undefined, (error) => {
        const detail = error instanceof Error ? error.message : String(error);
        log(Messages.Log.LANGUAGE_SERVER_RESTART_FAILED(detail));
    });
}

/**
 * Mismatch toast (informational, not an error: restarting IS the fix).
 * [Restart Language Server] applies the new JDK without a window reload;
 * [Show Logs] opens the per-project detail in the "Jaenvtix" channel.
 */
function notifyMismatchWithActions(message: string, showLogs: () => void): void {
    void vscode.window.showInformationMessage(
        message,
        Messages.Choice.RESTART_LANGUAGE_SERVER,
        Messages.Choice.SHOW_LOGS,
    ).then((choice) => {
        if (choice === Messages.Choice.RESTART_LANGUAGE_SERVER) {
            restartLanguageServer();
        } else if (choice === Messages.Choice.SHOW_LOGS) {
            showLogs();
        }
    });
}

function buildProgressMessage(step: ConfigurationStep): string {
    return Messages.Progress.STEPS[step.name] ?? Messages.Progress.DEFAULT;
}

async function runStepsWithProgress(
    steps: ConfigurationStep[],
    state: JavaConfigurationState
): Promise<ConfigurationStepResult> {
    if (steps.length === 0) {
        return StepResult.success();
    }

    const increment = 100 / steps.length;

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: Messages.Progress.TITLE,
        cancellable: true,
    }, async (progress, token) => {
        for (const step of steps) {
            if (token.isCancellationRequested) {
                return StepResult.warning(Messages.Warning.CONFIGURATION_CANCELLED);
            }

            const message = buildProgressMessage(step);
            progress.report({increment: 0, message});

            const result = await runStep(step, state);
            if (!result.success) {
                return result;
            }

            progress.report({increment});
        }

        return StepResult.success();
    });
}

/**
 * Entry point for the `jaenvtix.configureJava` command.
 *
 * Business rules:
 * - Runs the `preConfirm` steps synchronously (no progress UI). If any step
 *   returns a non-success result the pipeline is aborted immediately.
 * - On success, runs the `postConfirm` steps wrapped in a VS Code progress
 *   notification with per-step labels and a cancellation token.
 * - A `warning` result shows a warning notification; an `error` result shows
 *   an error notification. A result with no message is silently discarded
 *   (e.g. the user dismissed the confirm prompt).
 * - After a successful run: offers a one-click Language Server restart when
 *   the run changed the server's JDK, and — when the server was still
 *   loading at the end of the run — arms a detached continuation that
 *   re-runs refresh + verification once `serverReady` resolves.
 */
export async function runConfigureJavaCommand(
    options?: ConfigureJavaOptions,
    deps: ConfigureJavaDeps = NOOP_DEPS,
): Promise<void> {
    const {preConfirm, postConfirm} = getDefaultStepGroups(
        vscode.workspace.workspaceFolders,
        options,
        deps,
    );
    const state = createInitialState();
    let result = await runSteps(preConfirm, state);

    if (result.success) {
        result = await runStepsWithProgress(postConfirm, state);
    }

    if (!result.success) {
        if (!result.message) {
            return;
        }

        if (result.kind === 'error') {
            vscode.window.showErrorMessage(result.message);
        } else {
            vscode.window.showWarningMessage(result.message);
        }
        return;
    }

    // Before any toast: this is what makes the next activation able to tell a
    // configured workspace from one whose .vscode was deleted.
    await deps.recordConfigured?.(
        state.projectContexts.map((context) => buildVsCodeSettingPath(context.projectPath)),
    );

    vscode.window.showInformationMessage(Messages.Info.CONFIGURATION_COMPLETED);

    // terminal.integrated.env.* and maven.terminal.customEnv only apply to
    // terminals opened after the change — tell the user when it matters.
    if (state.terminalEnvUpdated && vscode.window.terminals.length > 0) {
        vscode.window.showInformationMessage(Messages.Info.REOPEN_TERMINALS);
    }

    offerLanguageServerRestartIfNeeded(state);
    armServerReadyContinuation(state, deps);
}

/**
 * When the run changed `java.jdt.ls.java.home`, the new JDK only takes
 * effect after a Language Server restart — offer it as one click.
 *
 * Business rules:
 * - ALWAYS opt-in via the button, NEVER an automatic restart: restarting
 *   re-imports the whole workspace (expensive in monorepos) and must not
 *   interrupt the user without consent.
 * - Suppressed when the verification toast already appeared (it carries the
 *   same restart action) and when the Red Hat extension is absent (there is
 *   no server to restart).
 * - The Red Hat extension may show its own "configuration changed" prompt in
 *   parallel; that redundancy is harmless and cannot be suppressed.
 */
function offerLanguageServerRestartIfNeeded(state: JavaConfigurationState): void {
    if (!state.jdtLsJavaHomeChanged || state.mismatchNotified) {
        return;
    }

    if (state.languageServerWait?.outcome === 'extension-missing') {
        return;
    }

    void vscode.window.showInformationMessage(
        Messages.Info.LS_JDK_CHANGED_RESTART,
        Messages.Choice.RESTART_LANGUAGE_SERVER,
    ).then((choice) => {
        if (choice === Messages.Choice.RESTART_LANGUAGE_SERVER) {
            restartLanguageServer();
        }
    });
}

/**
 * The in-progress wait for `serverReady` is capped so the progress
 * notification stays short — but a timeout never abandons the work. This
 * arms a detached continuation on the still-live readiness promise: when the
 * server finishes loading, the deferred refresh + verification run with
 * fresh values (never by the clock). If the window closes first, nothing
 * happens and the next open re-runs the pipeline.
 */
function armServerReadyContinuation(state: JavaConfigurationState, deps: ConfigureJavaDeps): void {
    const wait = state.languageServerWait;
    if (wait?.outcome !== 'timeout' || !wait.becameReady) {
        return;
    }

    // Guard against double execution: the continuation must run at most once
    // even if the readiness promise is shared across consumers.
    let resumed = false;
    void wait.becameReady.then(async () => {
        if (resumed) {
            return;
        }
        resumed = true;

        log(Messages.Log.SERVER_READY_CONTINUATION_RESUMED);
        state.languageServerWait = {outcome: 'ready'};
        await runStep(buildRefreshStep(), state);
        await runStep(buildVerifyStep(deps), state);
    });
}
