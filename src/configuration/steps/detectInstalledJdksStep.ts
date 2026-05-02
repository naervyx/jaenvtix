import {findRuntimes} from 'jdk-utils';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {selectBestJdkForVersion} from '../../build/jdkDetection';

function parseJavaMajor(version: string): number {
    const parsed = Number.parseInt(version, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Scans the user's machine for already-installed JDKs (JAVA_HOME, JDK_HOME,
 * PATH, SDKMAN, jEnv, jabba, asdf, gradle, jbang) and remembers, per Java
 * major version requested by the workspace's poms, the best matching one.
 *
 * Downstream `PrepareVersionPathsStep` will prefer these paths to the
 * Jaenvtix download cache, eliminating redundant downloads when a usable
 * JDK is already on the machine.
 *
 * Cooperative philosophy: this step never moves, modifies, or registers
 * anything globally. It just records "there is a JDK here" so we can use it.
 */
export class DetectInstalledJdksStep implements ConfigurationStep {
    readonly name = 'DetectInstalledJdks';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        state.detectedJdks.clear();

        if (state.projectVersionMap.size === 0) {
            return StepResult.success();
        }

        const runtimes = await findRuntimes({
            withVersion: true,
            withTags: true,
            checkJavac: true,
        });

        for (const version of state.projectVersionMap.keys()) {
            const major = parseJavaMajor(version);
            if (!major) {
                continue;
            }

            const best = selectBestJdkForVersion(runtimes, major);
            if (best) {
                state.detectedJdks.set(version, best.homedir);
            }
        }

        return StepResult.success();
    }
}
