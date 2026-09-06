import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildDefaultM2RepositoryPath,
    buildDefaultM2SettingsPath,
    buildJaenvtixMavenScriptPath,
    buildMavenBinPath,
    buildMavenInstallationPath,
    hasMavenInstallation,
} from '../../build/directory';
import {writeJaenvtixMavenWrapper} from '../../build/mavenWrapperScript';
import {collectPinnedMavenRequirements} from '../mavenRequirements';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';
import type {PlatformType} from '../../core/system';

/**
 * Writes the Jaenvtix Maven wrapper script (`jaenvtix-mvn` / `jaenvtix-mvn.cmd`)
 * for each Java version into the version's Maven `bin/` directory: both the
 * shared `mvn-custom` slot and any isolated `mvn-<version>` slots pinned by
 * projects.
 *
 * Business rules:
 * - Skips wrapper generation for a slot when no Maven binary is present in
 *   its `bin/`; this happens when every project for that version ships
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

        const pinnedRequirements = collectPinnedMavenRequirements(state);

        for (const [javaVersion, paths] of state.versionPaths) {
            this.writeWrapperForSlot(javaVersion, paths.jdkHome, paths.toolHome, paths.toolBin, state.platform);

            for (const mavenVersion of pinnedRequirements.get(javaVersion) ?? []) {
                this.writeWrapperForSlot(
                    javaVersion,
                    paths.jdkHome,
                    buildMavenInstallationPath(javaVersion, mavenVersion),
                    buildMavenBinPath(javaVersion, mavenVersion),
                    state.platform,
                );
            }
        }

        return StepResult.success();
    }

    private writeWrapperForSlot(
        javaVersion: string,
        jdkHome: string,
        toolHome: string,
        toolBin: string,
        platform: PlatformType,
    ): void {
        // A slot without a `mvn`/`mvn.cmd` was deliberately not provisioned
        // (e.g. mvnw-driven workspace). Generating a wrapper that points at a
        // nonexistent binary would create a broken file, so skip it.
        if (!hasMavenInstallation(toolBin, platform)) {
            return;
        }

        const scriptPath = buildJaenvtixMavenScriptPath(toolBin, platform);
        const result = writeJaenvtixMavenWrapper({
            jdkHome,
            toolHome,
            toolBin,
            userSettingsPath: buildDefaultM2SettingsPath(),
            localRepoPath: buildDefaultM2RepositoryPath(),
            platform,
            scriptPath,
        });

        if (result.updated) {
            log(Messages.Log.MAVEN_WRAPPER_WRITTEN(javaVersion, result.scriptPath));
        }
    }
}
