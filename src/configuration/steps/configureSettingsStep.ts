import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildDefaultM2SettingsPath,
    buildMavenWrapperPath,
    buildVsCodeSettingPath,
} from '../../build/directory';
import {updateVsCodeSettings} from '../../build/settingTag';
import {Messages} from '../../util/message';
import {isJavaVersionAtLeast, TOOLING_JAVA_MIN_VERSION, toJavaRuntimeName} from '../../util/javaVersion';

interface JavaRuntime {
    name: string;
    path: string;
    default?: boolean;
}

export class ConfigureSettingsStep implements ConfigurationStep {
    readonly name = 'ConfigureSettings';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        for (const projectContext of state.projectContexts) {
            const settingsPath = buildVsCodeSettingPath(projectContext.projectPath);
            const useToolingJavaHome = isJavaVersionAtLeast(projectContext.javaVersion, TOOLING_JAVA_MIN_VERSION);
            const runtimes: JavaRuntime[] | undefined = useToolingJavaHome ? undefined : [{
                name: toJavaRuntimeName(projectContext.javaVersion),
                path: projectContext.jdkHome,
                default: true,
            }];

            const javaMavenPaths = {
                javaHomePath: useToolingJavaHome ? projectContext.jdkHome : undefined,
                runtimes,
                terminalJavaHome: projectContext.jdkHome,
                mavenHomePath: projectContext.toolHome,
                mavenBinPath: projectContext.toolBin,
                mavenExecutablePath: buildMavenWrapperPath(projectContext.toolBin, projectContext.platform),
                userSettingsPath: buildDefaultM2SettingsPath(),
                platform: projectContext.platform,
            };

            const updateResult = updateVsCodeSettings(settingsPath, javaMavenPaths);
            if (updateResult.updated) {
                console.log(Messages.Log.SETTINGS_UPDATED(projectContext.projectPath, updateResult.updatedKeys));
            }
        }

        return StepResult.success();
    }
}
