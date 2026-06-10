import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, JavaRuntime, StepResult} from '../../core/types';
import {
    buildDefaultM2SettingsPath,
    buildJaenvtixMavenScriptPath,
    buildVsCodeSettingPath,
} from '../../build/directory';
import {updateVsCodeSettings} from '../../build/vsCodeSettingsWriter';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';
import {isJavaVersionAtLeast, TOOLING_JAVA_MIN_VERSION, toJavaRuntimeName} from '../../util/javaVersion';

/**
 * Writes or updates the per-project `.vscode/settings.json` for each `ProjectContext`.
 *
 * Business rules:
 * - For Java 21+ projects: writes `java.jdt.ls.java.home` (jdt.ls uses the
 *   project JDK directly); the `runtimes` array is omitted.
 * - For Java < 21 projects: omits `java.jdt.ls.java.home`; writes a
 *   `java.configuration.runtimes` entry so jdt.ls can compile the project
 *   using the correct source level while running on its own bundled JDK.
 * - When the project ships `mvnw`: leaves `maven.executable.path` undefined so
 *   vscode-maven defers to the project wrapper.
 * - When the project does NOT ship `mvnw`: points `maven.executable.path` at
 *   the Jaenvtix wrapper script which enforces `JAVA_HOME` before invoking Maven.
 * - Delegates all merge and persistence logic to `updateVsCodeSettings`.
 */
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

            // If the project ships its own `mvnw`, leave `maven.executable.path`
            // undefined so vscode-maven picks the project's wrapper. JAVA_HOME
            // still flows through `terminal.integrated.env.*` and the per-folder
            // `maven.terminal.customEnv` reinforces it for the Maven Explorer
            // terminal. Otherwise, point at the Jaenvtix wrapper which forces
            // JAVA_HOME explicitly before invoking Maven.
            const mavenExecutablePath = projectContext.hasMvnw
                ? undefined
                : buildJaenvtixMavenScriptPath(projectContext.toolBin, projectContext.platform);

            const javaMavenPaths = {
                javaHomePath: useToolingJavaHome ? projectContext.jdkHome : undefined,
                runtimes,
                terminalJavaHome: projectContext.jdkHome,
                mavenHomePath: projectContext.toolHome,
                mavenBinPath: projectContext.toolBin,
                mavenExecutablePath,
                userSettingsPath: buildDefaultM2SettingsPath(),
                platform: projectContext.platform,
            };

            const updateResult = updateVsCodeSettings(settingsPath, javaMavenPaths);
            if (updateResult.updated) {
                log(Messages.Log.SETTINGS_UPDATED(projectContext.projectPath, updateResult.updatedKeys));
            }
        }

        return StepResult.success();
    }
}
