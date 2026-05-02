import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    buildJdkVersionPath,
    buildMavenBinPath,
    buildMavenInstallationPath,
} from '../../build/directory';

/**
 * Computes the per-version paths the rest of the pipeline relies on:
 * - `jdkHome`: prefer a previously-detected installed JDK; otherwise fall
 *   back to the Jaenvtix cache slot (which a later step will populate via
 *   download + extraction).
 * - `toolHome`/`toolBin`: ALWAYS the Jaenvtix cache slot. Maven is owned
 *   by Jaenvtix (no system Maven reuse) so the wrapper script and the
 *   `~/.m2/settings.xml` enforcement remain predictable.
 */
export class PrepareVersionPathsStep implements ConfigurationStep {
    readonly name = 'PrepareVersionPaths';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        state.versionPaths.clear();

        for (const javaVersion of state.projectVersionMap.keys()) {
            const detectedJdk = state.detectedJdks.get(javaVersion);
            state.versionPaths.set(javaVersion, {
                jdkHome: detectedJdk ?? buildJdkVersionPath(javaVersion),
                toolHome: buildMavenInstallationPath(javaVersion),
                toolBin: buildMavenBinPath(javaVersion),
            });
        }

        return StepResult.success();
    }
}
