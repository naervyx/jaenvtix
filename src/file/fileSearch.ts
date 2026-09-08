import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Returns all directories under `root` that contain a file named `fileName`.
 *
 * Business rules:
 * - Checks `root` itself first, then scans one level of immediate child directories.
 * - Intentionally non-recursive: scanning deeply nested trees would be slow and
 *   would return submodules or vendored dependencies that are not top-level projects.
 */
export function findProjectsWithFile(root: string, fileName: string): string[] {
    const projects: string[] = [];

    const rootFile = join(root, fileName);
    if (existsSync(rootFile)) {
        projects.push(root);
    }

    const children = readdirSync(root, {withFileTypes: true});
    for (const child of children) {
        if (child.isDirectory()) {
            const childPath = join(root, child.name);
            const file = join(childPath, fileName);
            if (existsSync(file)) {
                projects.push(childPath);
            }
        }
    }

    return projects;
}

/**
 * Detects whether a Maven project ships its own Maven Wrapper.
 *
 * The wrapper is committed at the project root as `mvnw` (POSIX) and/or
 * `mvnw.cmd` (Windows). When present, it represents an explicit choice from
 * the project owners (frequently coupled with `.mvn/wrapper/maven-wrapper.properties`)
 * to pin the Maven version used during the build. Spring Initializr, Quarkus
 * and other modern generators ship it by default, and CI pipelines typically
 * rely on it for reproducibility.
 *
 * Jaenvtix detects this so it can stay out of the way: instead of pointing
 * `maven.executable.path` to its own wrapper, it preserves `mvnw` and only
 * injects `JAVA_HOME` via the per-folder terminal env. This prevents silent
 * drift between the IDE build and the CI build.
 */
export function detectMavenWrapper(projectPath: string): boolean {
    return existsSync(join(projectPath, 'mvnw')) || existsSync(join(projectPath, 'mvnw.cmd'));
}