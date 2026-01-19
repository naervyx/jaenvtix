import {isAbsolute, relative} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';

function resolveWorkspaceRoot(projectPath: string, workspaceFolders: string[]): string | null {
    let bestMatch: string | null = null;

    for (const folder of workspaceFolders) {
        const relativePath = relative(folder, projectPath);
        const isWithin = relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
        if (!isWithin) {
            continue;
        }

        if (!bestMatch || folder.length > bestMatch.length) {
            bestMatch = folder;
        }
    }

    return bestMatch;
}

export class BuildProjectContextsStep implements ConfigurationStep {
    readonly name = 'BuildProjectContexts';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform || !state.arch || state.workspaceFolders.length === 0) {
            return StepResult.error(Messages.Error.MISSING_WORKSPACE_PLATFORM_ARCH);
        }

        state.projectContexts = [];

        for (const [javaVersion, projects] of state.projectVersionMap) {
            const paths = state.versionPaths.get(javaVersion);
            if (!paths) {continue;}

            for (const project of projects) {
                const workspace = resolveWorkspaceRoot(project, state.workspaceFolders) ?? project;
                state.projectContexts.push({
                    workspace,
                    projectPath: project,
                    platform: state.platform,
                    arch: state.arch,
                    javaVersion,
                    jdkHome: paths.jdkHome,
                    toolHome: paths.toolHome,
                    toolBin: paths.toolBin,
                });
            }
        }

        return StepResult.success();
    }
}
