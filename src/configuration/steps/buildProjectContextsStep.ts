import {isAbsolute, relative} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {detectMavenWrapper} from '../../file/fileSearch';

/**
 * Returns the mvnw status for `project` from the cache populated by
 * `ResolveProjectsStep`. Falls back to a live filesystem check when the
 * cache entry is missing — defensive guard, should not occur in normal flow.
 */
function resolveHasMvnw(state: JavaConfigurationState, project: string): boolean {
    const cached = state.projectsHasMvnw.get(project);
    if (typeof cached === 'boolean') {
        return cached;
    }
    // Fallback: detect on-demand if for some reason the resolution step
    // didn't populate this entry (defensive — should not normally happen).
    return detectMavenWrapper(project);
}

/**
 * Returns the workspace folder that contains `projectPath`, preferring the
 * deepest (longest-path) match when multiple workspace folders overlap.
 * Returns `null` when no workspace folder is an ancestor of the project.
 */
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

/**
 * Constructs the final per-project `ProjectContext` objects consumed by the
 * settings, toolchains, wrapper, and launch configuration steps.
 *
 * Business rules:
 * - Produces one context per (Java version × project) pair, joining
 *   `state.projectVersionMap` with `state.versionPaths`.
 * - Must run after `ProcessDownloadsStep`: that step normalizes each
 *   version's `jdkHome` to the directory that actually contains `bin/java`
 *   (macOS archives extract as a `Contents/Home` bundle), and the contexts
 *   copy `jdkHome` by value.
 * - The `workspace` field is set to the deepest workspace folder that contains
 *   the project; falls back to `projectPath` itself when no workspace folder
 *   matches (e.g. a manually added folder outside the declared workspace).
 * - `hasMvnw` is read from the `ResolveProjectsStep` cache; a live fallback
 *   probe is used defensively if the cache entry is missing.
 */
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
                    hasMvnw: resolveHasMvnw(state, project),
                });
            }
        }

        return StepResult.success();
    }
}
