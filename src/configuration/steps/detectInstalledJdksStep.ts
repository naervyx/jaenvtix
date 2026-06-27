import {findRuntimes, getRuntime} from 'jdk-utils';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {DetectedJdk, selectBestJdkForVersion} from '../../build/jdkDetection';
import {DiscoveredToolchainJdk, readToolchainsXml} from '../../build/toolchainsXmlReader';
import {PackageManagerJdkCandidate, scanPackageManagerJdks} from '../../build/jdkSourceScanner';
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
    /** Override the Chocolatey/Homebrew directory scan. Defaults to the real one. */
    scanPackageManagerJdks?: () => PackageManagerJdkCandidate[];
}

/**
 * Scans the user's machine for already-installed JDKs (JAVA_HOME, JDK_HOME,
 * PATH, SDKMAN, jEnv, jabba, asdf, gradle, jbang) and remembers, per Java
 * major version requested by the workspace's poms, the best matching one.
 *
 * Two additional discovery sources extend `jdk-utils`:
 * - `~/.m2/toolchains.xml` (unless `jaenvtix.discoverFromToolchainsXml` is
 *   false): a dev who registered a JDK for `maven-toolchains-plugin`
 *   expressed intent, so valid entries join the candidate pool.
 * - Chocolatey (Windows) and Homebrew (macOS/Linux) installation
 *   directories, which `jdk-utils` does not cover and which otherwise
 *   require the user to set JAVA_HOME manually.
 *
 * Candidate precedence for the same version: system JDKs keep their
 * env-based priority, then toolchains entries (explicit user intent), then
 * package-manager installs. Every extra candidate must validate as a real
 * JDK (javac present) before joining the pool.
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

        candidates.push(...await this.collectPackageManagerJdks(candidates));

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

    /**
     * Validates `jdkHome` as a real JDK unless an equivalent candidate is
     * already in the pool. Returns `null` for duplicates and non-JDKs.
     */
    private async inspectCandidate(
        jdkHome: string,
        known: readonly DetectedJdk[],
    ): Promise<DetectedJdk | null> {
        if (known.some((candidate) => candidate.homedir === jdkHome)) {
            return null;
        }

        const inspect = this.deps.inspectJdk
            ?? ((home: string) => getRuntime(home, {withVersion: true, checkJavac: true}));
        const runtime = await inspect(jdkHome);
        return runtime?.hasJavac ? runtime : null;
    }

    private async collectToolchainsJdks(known: readonly DetectedJdk[]): Promise<DetectedJdk[]> {
        const readEntries = this.deps.readToolchainsJdks ?? readToolchainsXml;

        const discovered: DetectedJdk[] = [];
        for (const entry of readEntries()) {
            const runtime = await this.inspectCandidate(entry.jdkHome, [...known, ...discovered]);
            if (runtime) {
                discovered.push(runtime);
                log(Messages.Log.TOOLCHAINS_JDK_DETECTED(entry.jdkHome, entry.version));
            }
        }

        return discovered;
    }

    private async collectPackageManagerJdks(known: readonly DetectedJdk[]): Promise<DetectedJdk[]> {
        const scanCandidates = this.deps.scanPackageManagerJdks ?? scanPackageManagerJdks;

        const discovered: DetectedJdk[] = [];
        for (const candidate of scanCandidates()) {
            const runtime = await this.inspectCandidate(candidate.jdkHome, [...known, ...discovered]);
            if (runtime) {
                discovered.push(runtime);
                log(Messages.Log.PACKAGE_MANAGER_JDK_DETECTED(candidate.source, candidate.jdkHome));
            }
        }

        return discovered;
    }
}
