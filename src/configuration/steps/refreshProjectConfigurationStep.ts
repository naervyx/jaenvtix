import {join} from 'node:path';
import * as vscode from 'vscode';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {refreshAllProjects} from '../refreshProjectConfiguration';

const JAVA_PROJECT_CONFIGURATION_UPDATE = 'java.projectConfiguration.update';

/**
 * After Jaenvtix has rewritten settings.json (and friends), nudge the Red Hat
 * Java Language Server to re-import each project so the new runtime mapping
 * takes effect immediately. Without this, the user has to reload the window
 * to see the new classpath.
 *
 * If the Red Hat extension isn't installed, the command rejects per pom — we
 * swallow those errors silently because this step is cooperative, not core.
 */
export class RefreshProjectConfigurationStep implements ConfigurationStep {
    readonly name = 'RefreshProjectConfiguration';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.projectContexts.length === 0) {
            return StepResult.success();
        }

        const pomPaths = state.projectContexts.map((ctx) => join(ctx.projectPath, 'pom.xml'));

        await refreshAllProjects(pomPaths, async (pomPath) => {
            const uri = vscode.Uri.file(pomPath);
            await vscode.commands.executeCommand(JAVA_PROJECT_CONFIGURATION_UPDATE, uri);
        });

        return StepResult.success();
    }
}
