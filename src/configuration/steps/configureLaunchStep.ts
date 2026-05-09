import {basename} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {buildVsCodeLaunchPath} from '../../build/directory';
import {updateVsCodeLaunchConfig} from '../../build/launchConfig';
import {resolveJavaLaunchInfo} from '../../search/javaLaunchInfo';
import {Messages} from '../../util/message';

export interface ConfigureLaunchDeps {
    /**
     * Surfaces a malformed launch.json to the user. Wired by the orchestrator
     * to vscode.window.showWarningMessage so that data loss is visible
     * instead of being buried in console output. Defaults to a no-op for
     * unit tests that exercise the step directly.
     */
    notifyMalformed?: (filePath: string) => void;
}

/**
 * Generates a VS Code launch configuration for each Maven project that has a
 * discoverable main class.
 *
 * Business rules:
 * - Resolves the main class via `resolveJavaLaunchInfo`, which checks the
 *   `pom.xml` first (Spring Boot `<start-class>` / `<mainClass>`) and falls
 *   back to scanning `src/main/java` for a `main` method.
 * - Projects without a discoverable main class are silently skipped (a log
 *   message is written so the skip is auditable, but it is not an error).
 * - Generated config names follow the pattern `Jaenvtix: <Java|Spring Boot> (<ProjectName>)`.
 * - Delegates merge and persistence to `updateVsCodeLaunchConfig`.
 */
export class ConfigureLaunchStep implements ConfigurationStep {
    readonly name = 'ConfigureLaunch';

    constructor(private readonly deps: ConfigureLaunchDeps = {}) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        for (const projectContext of state.projectContexts) {
            const launchInfo = resolveJavaLaunchInfo(projectContext.projectPath);
            if (!launchInfo.mainClass) {
                console.log(Messages.Log.LAUNCH_SKIPPED(projectContext.projectPath));
                continue;
            }

            const projectLabel = launchInfo.projectName ?? basename(projectContext.projectPath);
            const launchLabel = launchInfo.isSpringBoot ? 'Spring Boot' : 'Java';
            const configName = `Jaenvtix: ${launchLabel} (${projectLabel})`;

            const launchConfig = {
                type: 'java',
                request: 'launch',
                name: configName,
                mainClass: launchInfo.mainClass,
                ...(launchInfo.projectName ? { projectName: launchInfo.projectName } : {}),
            };

            const launchPath = buildVsCodeLaunchPath(projectContext.projectPath);
            const updateResult = updateVsCodeLaunchConfig(launchPath, [launchConfig], {
                onMalformed: (filePath) => this.deps.notifyMalformed?.(filePath),
            });
            if (updateResult.updated) {
                console.log(Messages.Log.LAUNCH_UPDATED(projectContext.projectPath, updateResult.updatedNames));
            }
        }

        return StepResult.success();
    }
}
