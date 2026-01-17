import * as vscode from 'vscode';

import {ConfigurationStep, ConfigurationStepResult, StepResult} from '../types';
import {Messages} from '../../../util/message';

/**
 * Centralizes the user confirmation step so we can keep the pipeline linear.
 */
export class ConfirmConfigurationStep implements ConfigurationStep {
    readonly name = 'ConfirmConfiguration';

    async run(): Promise<ConfigurationStepResult> {
        const choice = await vscode.window.showInformationMessage(
            Messages.Info.START_CONFIG,
            Messages.Choice.YES,
            Messages.Choice.NO,
        );

        if (choice === Messages.Choice.YES) {
            return StepResult.success();
        }

        return { success: false };
    }
}
