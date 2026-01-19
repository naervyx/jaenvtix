import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildDefaultM2SettingsPath,
    buildMavenWrapperPath,
    buildVsCodeSettingPath,
} from '../../build/directory';
import {updateVsCodeSettings} from '../../build/settingTag';
import {Messages} from '../../util/message';

export class ConfigureSettingsStep implements ConfigurationStep {
    readonly name = 'ConfigureSettings';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        for (const projectContext of state.projectContexts) {
            const settingsPath = buildVsCodeSettingPath(projectContext.projectPath);
            const javaMavenPaths = {
                javaHomePath: projectContext.jdkHome,
                mavenBinPath: buildMavenWrapperPath(projectContext.toolBin, projectContext.platform),
                userSettingsPath: buildDefaultM2SettingsPath(),
            };

            const updateResult = updateVsCodeSettings(settingsPath, javaMavenPaths);
            if (updateResult.updated) {
                console.log(Messages.Log.SETTINGS_UPDATED(projectContext.projectPath, updateResult.updatedKeys));
            }
        }

        return StepResult.success();
    }
}
