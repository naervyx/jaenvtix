export interface JavaRuntime {
    name: string;
    path: string;
    sources?: string;
    javadoc?: string;
    default?: boolean;
}

export interface MergeResult {
    merged: JavaRuntime[];
    updated: boolean;
}

/**
 * Merge candidate runtimes into existing user-level `java.configuration.runtimes`
 * without clobbering the user's own choices.
 *
 * Business rules:
 * - Existing entries are preserved verbatim. The user may have manually pointed
 *   `JavaSE-17` to a JDK they prefer; Jaenvtix must not overwrite it.
 * - A candidate is added only when NO existing entry shares its `name`.
 * - A candidate is also skipped when an existing entry already has the same
 *   `path` (regardless of `name`), so we never end up with two entries
 *   pointing to the same JDK.
 * - The `default` flag is solely the user's responsibility — Jaenvtix neither
 *   sets nor strips it.
 *
 * The function is pure: it never reads the filesystem nor the VS Code API.
 * Callers are responsible for fetching `existing` and persisting `merged`.
 */
export function mergeUserRuntimes(
    existing: readonly JavaRuntime[],
    candidates: readonly JavaRuntime[]
): MergeResult {
    const merged: JavaRuntime[] = existing.map((entry) => ({...entry}));
    const existingNames = new Set(existing.map((entry) => entry.name));
    const existingPaths = new Set(existing.map((entry) => entry.path));
    let updated = false;

    for (const candidate of candidates) {
        if (existingNames.has(candidate.name)) {
            continue;
        }
        if (existingPaths.has(candidate.path)) {
            continue;
        }

        merged.push({name: candidate.name, path: candidate.path});
        existingNames.add(candidate.name);
        existingPaths.add(candidate.path);
        updated = true;
    }

    return {merged, updated};
}
