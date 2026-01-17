import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {ProjectContextBuilder} from '../../../core/contextCore';
import {initializeJdkEnvironment} from '../../build/directory';

export class BuildProjectContextsStep implements ConfigurationStep {
    readonly name = 'BuildProjectContexts';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform || !state.arch || !state.workspaceFolder) {
            return StepResult.error('Missing workspace, platform, or architecture information');
        }

        state.projectContexts = [];

        for (const [javaVersion, projects] of state.projectVersionMap) {
            const paths = state.versionPaths.get(javaVersion);
            if (!paths) {continue;}

            for (const project of projects) {
                const builder = new ProjectContextBuilder(state.workspaceFolder, project)
                    .withSystemInfo(state.platform, state.arch)
                    .withJavaVersion(javaVersion)
                    .withJdkHome(paths.jdkHome)
                    .withToolPaths(paths.toolHome, paths.toolBin);

                state.projectContexts.push(builder.build());
            }
        }

        for (const javaVersion of state.projectVersionMap.keys()) {
            initializeJdkEnvironment(javaVersion);
        }

        return StepResult.success();
    }
}
