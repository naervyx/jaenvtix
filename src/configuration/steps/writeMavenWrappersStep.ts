import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildDefaultM2RepositoryPath,
    buildDefaultM2SettingsPath,
    buildJaenvtixMavenScriptPath,
} from '../../build/directory';
import {writeJaenvtixMavenWrapper} from '../../build/mavenWrapperScript';
import {Messages} from '../../util/message';

export class WriteMavenWrappersStep implements ConfigurationStep {
    readonly name = 'WriteMavenWrappers';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM);
        }

        const userSettingsPath = buildDefaultM2SettingsPath();
        const localRepoPath = buildDefaultM2RepositoryPath();

        for (const [javaVersion, paths] of state.versionPaths) {
            const scriptPath = buildJaenvtixMavenScriptPath(paths.toolBin, state.platform);
            const result = writeJaenvtixMavenWrapper({
                jdkHome: paths.jdkHome,
                toolHome: paths.toolHome,
                toolBin: paths.toolBin,
                userSettingsPath,
                localRepoPath,
                platform: state.platform,
                scriptPath,
            });

            if (result.updated) {
                console.log(Messages.Log.MAVEN_WRAPPER_WRITTEN(javaVersion, result.scriptPath));
            }
        }

        return StepResult.success();
    }
}
