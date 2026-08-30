import * as vscode from 'vscode';

import {ConfigurationStep, ConfigurationStepResult, StepResult} from '../../core/types';
import {Messages} from '../../util/message';

/**
 * Asks the user for explicit confirmation before the potentially long-running
 * download and configuration phase begins.
 *
 * Business rules:
 * - Shows a Yes/No information message. Selecting "Yes" returns success;
 *   anything else (including dismissing the notification) halts the pipeline
 *   with `success: false` and no message; the user's choice is intentional.
 * - This step is omitted from the pipeline when `ConfigureJavaOptions.skipConfirmation`
 *   is set (e.g. when the auto-config prompt already asked the user at activation).
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

        return {success: false};
    }
}
