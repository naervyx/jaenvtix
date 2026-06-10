import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildDefaultM2RepositoryPath,
    buildDefaultM2SettingsPath,
    buildJaenvtixMavenScriptPath,
    hasMavenInstallation,
} from '../../build/directory';
import {writeJaenvtixMavenWrapper} from '../../build/mavenWrapperScript';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

/**
 * Writes the Jaenvtix Maven wrapper script (`jaenvtix-mvn` / `jaenvtix-mvn.cmd`)
 * for each Java version into the version's Maven `bin/` directory.
 *
 * Business rules:
 * - Skips wrapper generation for a version when no Maven binary is present in
 *   `paths.toolBin` — this happens when every project for that version ships
 *   its own `mvnw` and `ScheduleDownloadsStep` skipped the Maven download.
 *   Writing a wrapper that delegates to a non-existent `mvn` would produce a
 *   broken script.
 * - Uses change detection (content diff) so the file's mtime is not bumped on
 *   no-op re-runs.
 */
export class WriteMavenWrappersStep implements ConfigurationStep {
    readonly name = 'WriteMavenWrappers';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM);
        }

        const userSettingsPath = buildDefaultM2SettingsPath();
        const localRepoPath = buildDefaultM2RepositoryPath();

        for (const [javaVersion, paths] of state.versionPaths) {
            // When the workspace is fully `mvnw`-driven, `ScheduleDownloadsStep`
            // skipped the Maven download for this version, so `paths.toolBin`
            // does not contain a `mvn`/`mvn.cmd`. Generating a wrapper that
            // points at a nonexistent binary would just create a broken file —
            // skip and let the projects use their own `mvnw`.
            if (!hasMavenInstallation(paths.toolBin, state.platform)) {
                continue;
            }

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
                log(Messages.Log.MAVEN_WRAPPER_WRITTEN(javaVersion, result.scriptPath));
            }
        }

        return StepResult.success();
    }
}
