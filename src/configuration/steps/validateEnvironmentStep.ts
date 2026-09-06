import {ArchitectureType, PlatformType} from '../../core/system';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {getArchitecture, getPlatform, isArchitectureSupported, isPlatformSupported} from '../../core/system';
import {getMavenDistribution, MavenDistribution} from '../../build/mavenUrl';

// Structural shape: matches vscode.WorkspaceFolder at runtime without a
// runtime import on the `vscode` package, so this step (and its tests) load
// cleanly under plain Node / tsx outside of the VS Code extension host.
interface WorkspaceFolderLike {
    readonly uri: {readonly fsPath: string};
}

export interface ValidateEnvironmentDeps {
    /** Override the architecture probe. Defaults to process.arch lookup. */
    getArchitecture?: () => ArchitectureType;
    /** Override the platform probe. Defaults to process.platform lookup. */
    getPlatform?: () => PlatformType;
    /** Override the Maven distribution resolver. Defaults to the live one. */
    getMavenDistribution?: (platform: PlatformType) => Promise<MavenDistribution | null>;
}

/**
 * First step in the configuration pipeline. Validates that Jaenvtix can run in
 * the current environment and resolves the Maven distribution to use.
 *
 * Business rules:
 * - Returns a warning (not an error) for unsupported platform/architecture so
 *   the message shown to the user is non-alarming.
 * - Populates `state.platform`, `state.arch`, and `state.mavenDistribution` on
 *   success so downstream steps do not need to probe the environment again.
 * - Accepts `deps` for dependency injection so unit tests can exercise the step
 *   without making network requests or reading `process.platform`.
 */
export class ValidateEnvironmentStep implements ConfigurationStep {
    readonly name = 'ValidateEnvironment';

    constructor(
        private readonly workspaceFolders: readonly WorkspaceFolderLike[] | undefined,
        private readonly deps: ValidateEnvironmentDeps = {},
    ) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!this.workspaceFolders || this.workspaceFolders.length === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_WORKSPACE);
        }

        state.workspaceFolders = this.workspaceFolders.map((folder) => folder.uri.fsPath);

        const arch = (this.deps.getArchitecture ?? getArchitecture)();
        if (!isArchitectureSupported(arch)) {
            return StepResult.warning(Messages.Warning.ARCHITECTURE_NOT_SUPPORTED);
        }

        const platform = (this.deps.getPlatform ?? getPlatform)();
        if (!isPlatformSupported(platform)) {
            return StepResult.warning(Messages.Warning.PLATFORM_NOT_SUPPORTED);
        }

        const fetchMaven = this.deps.getMavenDistribution ?? getMavenDistribution;
        const mavenDistribution = await fetchMaven(platform);
        if (!mavenDistribution) {
            return StepResult.warning(Messages.Warning.MAVEN_DISTRIBUTION_NOT_FOUND);
        }

        state.arch = arch;
        state.platform = platform;
        state.mavenDistribution = mavenDistribution;

        return StepResult.success();
    }
}
