import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildJdkVersionPath,
    buildMavenBinPath,
    buildMavenInstallationPath,
} from '../../build/directory';

export class PrepareVersionPathsStep implements ConfigurationStep {
    readonly name = 'PrepareVersionPaths';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        state.versionPaths.clear();

        for (const javaVersion of state.projectVersionMap.keys()) {
            state.versionPaths.set(javaVersion, {
                jdkHome: buildJdkVersionPath(javaVersion),
                toolHome: buildMavenInstallationPath(javaVersion),
                toolBin: buildMavenBinPath(javaVersion),
            });
        }

        return StepResult.success();
    }
}
