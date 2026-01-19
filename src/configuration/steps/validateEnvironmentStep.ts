import * as vscode from 'vscode';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {getArchitecture, getPlatform, isArchitectureSupported, isPlatformSupported} from '../../core/system';
import {getMavenDistribution} from '../../build/mavenUrl';

export class ValidateEnvironmentStep implements ConfigurationStep {
    readonly name = 'ValidateEnvironment';

    constructor(private readonly workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!this.workspaceFolders || this.workspaceFolders.length === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_WORKSPACE);
        }

        state.workspaceFolders = this.workspaceFolders.map((folder) => folder.uri.fsPath);

        const arch = getArchitecture();
        if (!isArchitectureSupported(arch)) {
            return StepResult.warning(Messages.Warning.ARCHITECTURE_NOT_SUPPORTED);
        }

        const platform = getPlatform();
        if (!isPlatformSupported(platform)) {
            return StepResult.warning(Messages.Warning.PLATFORM_NOT_SUPPORTED);
        }

        const mavenDistribution = await getMavenDistribution(platform);
        if (!mavenDistribution) {
            return StepResult.warning(Messages.Warning.MAVEN_DISTRIBUTION_NOT_FOUND);
        }

        state.arch = arch;
        state.platform = platform;
        state.mavenDistribution = mavenDistribution;

        return StepResult.success();
    }
}
