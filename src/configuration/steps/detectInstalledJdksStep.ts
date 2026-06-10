import {findRuntimes, getRuntime} from 'jdk-utils';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {DetectedJdk, selectBestJdkForVersion} from '../../build/jdkDetection';
import {DiscoveredToolchainJdk, readToolchainsXml} from '../../build/toolchainsXmlReader';
import {parseJavaVersionNumber} from '../../util/javaVersion';
import {log} from '../../util/logger';
import {Messages} from '../../util/message';

export interface DetectInstalledJdksDeps {
    /** Override the machine-wide JDK scan. Defaults to `jdk-utils.findRuntimes`. */
    findRuntimes?: () => Promise<DetectedJdk[]>;
    /** Override the single-path JDK probe. Defaults to `jdk-utils.getRuntime`. */
    inspectJdk?: (jdkHome: string) => Promise<DetectedJdk | undefined>;
    /** Override the `~/.m2/toolchains.xml` reader. Defaults to the real file. */
    readToolchainsJdks?: () => DiscoveredToolchainJdk[];
    /**
     * Reads `jaenvtix.discoverFromToolchainsXml`; the orchestrator wires the
     * real configuration. Defaults to enabled (the setting's default).
     */
    isToolchainsDiscoveryEnabled?: () => boolean;
}

/**
 * Scans the user's machine for already-installed JDKs (JAVA_HOME, JDK_HOME,
 * PATH, SDKMAN, jEnv, jabba, asdf, gradle, jbang) and remembers, per Java
 * major version requested by the workspace's poms, the best matching one.
 *
 * `~/.m2/toolchains.xml` is honoured as an additional discovery source
 * (unless `jaenvtix.discoverFromToolchainsXml` is false): a dev who registered
 * a JDK for `maven-toolchains-plugin` expressed intent, so each entry that
 * validates as a real JDK (javac present) joins the candidate pool. System
 * candidates keep their priority — toolchains entries fill the gaps,
 * eliminating downloads for JDKs the user already pointed Maven at.
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

    constructor(private readonly deps: DetectInstalledJdksDeps = {}) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        state.detectedJdks.clear();

        if (state.projectVersionMap.size === 0) {
            return StepResult.success();
        }

        const scan = this.deps.findRuntimes
            ?? (() => findRuntimes({withVersion: true, withTags: true, checkJavac: true}));
        const candidates: DetectedJdk[] = [...await scan()];

        if (this.deps.isToolchainsDiscoveryEnabled?.() !== false) {
            candidates.push(...await this.collectToolchainsJdks(candidates));
        }

        for (const version of state.projectVersionMap.keys()) {
            const major = parseJavaVersionNumber(version);
            if (!major) {
                continue;
            }

            const best = selectBestJdkForVersion(candidates, major);
            if (best) {
                state.detectedJdks.set(version, best.homedir);
            }
        }

        return StepResult.success();
    }

    private async collectToolchainsJdks(known: readonly DetectedJdk[]): Promise<DetectedJdk[]> {
        const readEntries = this.deps.readToolchainsJdks ?? readToolchainsXml;
        const inspect = this.deps.inspectJdk
            ?? ((jdkHome: string) => getRuntime(jdkHome, {withVersion: true, checkJavac: true}));

        const discovered: DetectedJdk[] = [];
        for (const entry of readEntries()) {
            if (known.some((candidate) => candidate.homedir === entry.jdkHome)) {
                continue;
            }

            const runtime = await inspect(entry.jdkHome);
            if (runtime?.hasJavac) {
                discovered.push(runtime);
                log(Messages.Log.TOOLCHAINS_JDK_DETECTED(entry.jdkHome, entry.version));
            }
        }

        return discovered;
    }
}
