import * as vscode from 'vscode';

import {JavaConfigurationWorkflow} from './javaConfigurationWorkflow';
import {ConfirmConfigurationStep} from './steps/confirmConfigurationStep';
import {ValidateEnvironmentStep} from './steps/validateEnvironmentStep';
import {ResolveProjectsStep} from './steps/resolveProjectsStep';
import {PrepareVersionPathsStep} from './steps/prepareVersionPathsStep';
import {ScheduleDownloadsStep} from './steps/scheduleDownloadsStep';
import {BuildProjectContextsStep} from './steps/buildProjectContextsStep';
import {ProcessDownloadsStep} from './steps/processDownloadsStep';
import {ConfigureSettingsStep} from './steps/configureSettingsStep';
import {createInitialState} from './types';

function createWorkflow(workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): JavaConfigurationWorkflow {
    return new JavaConfigurationWorkflow([
        new ValidateEnvironmentStep(workspaceFolders),
        new ResolveProjectsStep(),
        new ConfirmConfigurationStep(),
        new PrepareVersionPathsStep(),
        new ScheduleDownloadsStep(),
        new BuildProjectContextsStep(),
        new ProcessDownloadsStep(),
        new ConfigureSettingsStep(),
    ]);
}

export async function runConfigureJavaCommand(): Promise<void> {
    const workflow = createWorkflow(vscode.workspace.workspaceFolders);
    const state = createInitialState();
    const result = await workflow.run(state);

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

    vscode.window.showInformationMessage('Java/Maven environment configuration completed successfully!');
}
