import {basename} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {buildVsCodeLaunchPath} from '../../build/directory';
import {updateVsCodeLaunchConfig} from '../../build/launchConfig';
import {resolveJavaLaunchInfo} from '../../search/javaLaunchInfo';
import {Messages} from '../../util/message';

export class ConfigureLaunchStep implements ConfigurationStep {
    readonly name = 'ConfigureLaunch';

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
            const updateResult = updateVsCodeLaunchConfig(launchPath, [launchConfig]);
            if (updateResult.updated) {
                console.log(Messages.Log.LAUNCH_UPDATED(projectContext.projectPath, updateResult.updatedNames));
            }
        }

        return StepResult.success();
    }
}
