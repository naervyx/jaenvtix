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
