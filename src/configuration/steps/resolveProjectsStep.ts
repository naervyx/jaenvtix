import {relative, isAbsolute, sep} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {detectMavenWrapper, findProjectsWithFile} from '../../file/fileSearch';
import {parseJavaVersionFromPom} from '../../search/javaVersion';
import {parseMavenVersionFromPom} from '../../search/mavenVersion';

export interface ResolveProjectsDeps {
    /**
     * Reads `jaenvtix.isolatedMavenPerProject`; the orchestrator wires the
     * real configuration. Defaults to enabled (the setting's default). When
     * off, poms are not inspected for pinned Maven versions and every project
     * shares the Jaenvtix-latest Maven.
     */
    isIsolatedMavenEnabled?: () => boolean;
}

/**
 * Returns true when `descendant` is strictly nested under `ancestor` (not the
 * same path). Path-aware so it works on both POSIX and Windows separators.
 */
function isStrictDescendant(ancestor: string, descendant: string): boolean {
    if (ancestor === descendant) {return false;}
    const rel = relative(ancestor, descendant);
    if (!rel) {return false;}
    if (rel.startsWith('..' + sep) || rel === '..') {return false;}
    if (isAbsolute(rel)) {return false;}
    return true;
}

/**
 * Among `candidates`, finds the closest path that is a strict ancestor of
 * `descendant`. "Closest" means longest matching prefix, so a parent module
 * inside a sub-tree wins over the workspace root.
 */
function findClosestAncestor(descendant: string, candidates: readonly string[]): string | null {
    let bestMatch: string | null = null;
    for (const candidate of candidates) {
        if (!isStrictDescendant(candidate, descendant)) {continue;}
        if (!bestMatch || candidate.length > bestMatch.length) {
            bestMatch = candidate;
        }
    }
    return bestMatch;
}

/**
 * Discovers all Maven projects in the workspace and resolves the Java version
 * required by each, including multi-module inheritance.
 *
 * Business rules:
 * - Scans one level deep in each workspace folder for `pom.xml` files.
 * - Detects `mvnw`/`mvnw.cmd` for each project and stores the result in
 *   `state.projectsHasMvnw` so downstream steps can reuse it without a second
 *   filesystem hit.
 * - A child pom that declares no Java version inherits from the closest ancestor
 *   pom in the same workspace that does declare one. This mirrors how Spring Boot,
 *   Quarkus, and other Maven monorepos structure their parent-child version ownership.
 * - When isolated Maven is enabled (default), each pom is also inspected for a
 *   pinned Maven version (`<prerequisites><maven>` / `<properties><maven.version>`)
 *   so downstream steps can provision one Maven per pinned version.
 * - Returns a warning (no error) when no projects or no Java versions are found,
 *   so the pipeline stops quietly rather than showing a red error message.
 */
export class ResolveProjectsStep implements ConfigurationStep {
    readonly name = 'ResolveProjects';

    constructor(private readonly deps: ResolveProjectsDeps = {}) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.workspaceFolders.length === 0) {
            return StepResult.error(Messages.Error.WORKSPACE_FOLDER_NOT_RESOLVED);
        }

        const projectSet = new Set<string>();
        for (const workspaceFolder of state.workspaceFolders) {
            for (const project of findProjectsWithFile(workspaceFolder, 'pom.xml')) {
                projectSet.add(project);
            }
        }

        const projects = [...projectSet];
        if (projects.length === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_POM);
        }

        state.projectVersionMap.clear();
        state.projectsHasMvnw.clear();
        state.projectMavenVersions.clear();

        const isolatedMaven = this.deps.isIsolatedMavenEnabled?.() !== false;
        const projectVersions = new Map<string, string>();

        for (const project of projects) {
            // Detect mvnw once here so downstream steps (download scheduling,
            // wrapper writing, project-context building) can reuse the result
            // without hitting the filesystem again.
            state.projectsHasMvnw.set(project, detectMavenWrapper(project));

            const javaVersion = parseJavaVersionFromPom(project);
            if (javaVersion) {
                projectVersions.set(project, javaVersion);
            }

            if (isolatedMaven) {
                const mavenVersion = parseMavenVersionFromPom(project);
                if (mavenVersion) {
                    state.projectMavenVersions.set(project, mavenVersion);
                }
            }
        }

        // Multi-module inheritance: a child pom that declares no Java version
        // of its own inherits from the closest ancestor pom in the same
        // workspace that does declare one. This matches the typical Maven
        // monorepo (Spring Boot, Quarkus, etc.) where the parent pom owns
        // `<java.version>` and modules inherit silently.
        const projectsWithDirectVersion = [...projectVersions.keys()];
        for (const project of projects) {
            if (projectVersions.has(project)) {continue;}
            const ancestor = findClosestAncestor(project, projectsWithDirectVersion);
            if (!ancestor) {continue;}
            const inherited = projectVersions.get(ancestor);
            if (inherited) {
                projectVersions.set(project, inherited);
            }
        }

        for (const [project, version] of projectVersions) {
            const projectList = state.projectVersionMap.get(version) ?? [];
            projectList.push(project);
            state.projectVersionMap.set(version, projectList);
        }

        if (state.projectVersionMap.size === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_JAVA_VERSION);
        }

        return StepResult.success();
    }
}
