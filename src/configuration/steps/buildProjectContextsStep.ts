import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {Messages} from '../../util/message';

export class BuildProjectContextsStep implements ConfigurationStep {
    readonly name = 'BuildProjectContexts';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform || !state.arch || !state.workspaceFolder) {
            return StepResult.error(Messages.Error.MISSING_WORKSPACE_PLATFORM_ARCH);
        }

        state.projectContexts = [];

        for (const [javaVersion, projects] of state.projectVersionMap) {
            const paths = state.versionPaths.get(javaVersion);
            if (!paths) {continue;}

            for (const project of projects) {
                state.projectContexts.push({
                    workspace: state.workspaceFolder,
                    projectPath: project,
                    platform: state.platform,
                    arch: state.arch,
                    javaVersion,
                    jdkHome: paths.jdkHome,
                    toolHome: paths.toolHome,
                    toolBin: paths.toolBin,
                });
            }
        }

        return StepResult.success();
    }
}
