import * as vscode from 'vscode';

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
import {ConfigureUserRuntimesStep} from './steps/configureUserRuntimesStep';
import {ConfigureLaunchStep} from './steps/configureLaunchStep';
import {RefreshProjectConfigurationStep} from './steps/refreshProjectConfigurationStep';
import {ConfigurationStep, ConfigurationStepResult, createInitialState, JavaConfigurationState, StepResult} from '../core/types';
import {Messages} from '../util/message';
import {runStep, runSteps} from './stepRunner';

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
 * Builds the default two-phase step list for the `jaenvtix.configureJava` command.
 * The `preConfirm` list always includes validation and project resolution; the
 * `ConfirmConfigurationStep` is added only when `options.skipConfirmation` is not set.
 */
export function getDefaultStepGroups(
    workspaceFolders: readonly {uri: {fsPath: string}}[] | undefined,
    options: ConfigureJavaOptions = {},
): StepGroups {
    const preConfirm: ConfigurationStep[] = [
        new ValidateEnvironmentStep(workspaceFolders),
        new ResolveProjectsStep(),
    ];
    if (!options.skipConfirmation) {
        preConfirm.push(new ConfirmConfigurationStep());
    }

    return {
        preConfirm,
        postConfirm: [
            new InitializeDirectoriesStep(),
            new DetectInstalledJdksStep(),
            new PrepareVersionPathsStep(),
            new ScheduleDownloadsStep(),
            new BuildProjectContextsStep(),
            new ProcessDownloadsStep(),
            new WriteMavenWrappersStep(),
            new WriteToolchainsStep(),
            new ConfigureSettingsStep(),
            new ConfigureUserRuntimesStep(),
            new ConfigureLaunchStep({
                notifyMalformed: (filePath) => {
                    void vscode.window.showWarningMessage(
                        Messages.Warning.LAUNCH_JSON_MALFORMED(filePath)
                    );
                },
            }),
            new RefreshProjectConfigurationStep(),
        ],
    };
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
            progress.report({ increment: 0, message });

            const result = await runStep(step, state);
            if (!result.success) {
                return result;
            }

            progress.report({ increment });
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
 */
export async function runConfigureJavaCommand(options?: ConfigureJavaOptions): Promise<void> {
    const { preConfirm, postConfirm } = getDefaultStepGroups(
        vscode.workspace.workspaceFolders,
        options,
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

    vscode.window.showInformationMessage(Messages.Info.CONFIGURATION_COMPLETED);
}
