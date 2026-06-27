import type {JavaConfigurationState} from '../core/types';

/**
 * Derives which isolated Maven slots the workspace needs: for every Java
 * version, the set of Maven versions pinned by its projects.
 *
 * Business rules:
 * - Projects shipping their own `mvnw` are excluded — Jaenvtix yields to the
 *   project wrapper and never provisions Maven for them.
 * - Shared by the download-scheduling, extraction, and wrapper-writing steps
 *   so all three agree on exactly the same (Java × Maven) pairs.
 */
export function collectPinnedMavenRequirements(
    state: JavaConfigurationState,
): Map<string, Set<string>> {
    const requirements = new Map<string, Set<string>>();

    for (const [javaVersion, projects] of state.projectVersionMap) {
        for (const project of projects) {
            if (state.projectsHasMvnw.get(project) === true) {
                continue;
            }
            const mavenVersion = state.projectMavenVersions.get(project);
            if (!mavenVersion) {
                continue;
            }
            const versions = requirements.get(javaVersion) ?? new Set<string>();
            versions.add(mavenVersion);
            requirements.set(javaVersion, versions);
        }
    }

    return requirements;
}
