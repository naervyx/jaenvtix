import * as vscode from 'vscode';

import {ConfirmConfigurationStep} from './steps/confirmConfigurationStep';
import {ValidateEnvironmentStep} from './steps/validateEnvironmentStep';
import {ResolveProjectsStep} from './steps/resolveProjectsStep';
import {InitializeDirectoriesStep} from './steps/initializeDirectoriesStep';
import {PrepareVersionPathsStep} from './steps/prepareVersionPathsStep';
import {ScheduleDownloadsStep} from './steps/scheduleDownloadsStep';
import {BuildProjectContextsStep} from './steps/buildProjectContextsStep';
import {ProcessDownloadsStep} from './steps/processDownloadsStep';
import {ConfigureSettingsStep} from './steps/configureSettingsStep';
import {ConfigurationStep, ConfigurationStepResult, createInitialState, JavaConfigurationState, StepResult} from '../core/types';
import {Messages} from '../util/message';

function createStepGroups(workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): {
    preConfirm: ConfigurationStep[];
    postConfirm: ConfigurationStep[];
} {
    return {
        preConfirm: [
            new ValidateEnvironmentStep(workspaceFolders),
            new ResolveProjectsStep(),
            new ConfirmConfigurationStep(),
        ],
        postConfirm: [
            new InitializeDirectoriesStep(),
            new PrepareVersionPathsStep(),
            new ScheduleDownloadsStep(),
            new BuildProjectContextsStep(),
            new ProcessDownloadsStep(),
            new ConfigureSettingsStep(),
        ],
    };
}

function getStepLabel(step: ConfigurationStep): string {
    return Messages.Progress.STEPS[step.name] ?? step.name;
}

function buildProgressMessage(step: ConfigurationStep): string {
    return Messages.Progress.STEPS[step.name] ?? Messages.Progress.DEFAULT;
}

async function runStep(
    step: ConfigurationStep,
    state: JavaConfigurationState
): Promise<ConfigurationStepResult> {
    try {
        return await step.run(state);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return StepResult.error(Messages.Error.STEP_FAILED(getStepLabel(step), message));
    }
}

async function runSteps(
    steps: ConfigurationStep[],
    state: JavaConfigurationState
): Promise<ConfigurationStepResult> {
    for (const step of steps) {
        const result = await runStep(step, state);
        if (!result.success) {
            return result;
        }
    }

    return StepResult.success();
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

export async function runConfigureJavaCommand(): Promise<void> {
    const { preConfirm, postConfirm } = createStepGroups(vscode.workspace.workspaceFolders);
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
