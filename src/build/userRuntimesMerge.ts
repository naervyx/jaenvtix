import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {fixPath} from './runtimePathFix';
import type {JavaRuntime} from '../core/types';

export interface MergeResult {
    merged: JavaRuntime[];
    updated: boolean;
}

export interface FixedRuntime {
    entry: JavaRuntime;
    oldPath: string;
}

export interface CleanResult {
    kept: JavaRuntime[];
    fixed: FixedRuntime[];
    removed: JavaRuntime[];
}

export function validateRuntime(entry: JavaRuntime, os: NodeJS.Platform): boolean {
    const binary = os === 'win32' ? 'javac.exe' : 'javac';
    return existsSync(join(entry.path, 'bin', binary));
}

/**
 * Validate existing `java.configuration.runtimes` entries and attempt to
 * recover those with broken paths before falling back to removal.
 *
 * - Valid entries are kept as-is (name, default, sources, javadoc preserved).
 * - Invalid entries are fixed via fixPath() when enableFix is true, rewriting
 *   only the path while preserving all other fields.
 * - Entries that cannot be fixed (or when enableFix is false) are removed.
 */
export function validateAndCleanRuntimes(
    existing: readonly JavaRuntime[],
    enableFix: boolean,
    os: NodeJS.Platform,
): CleanResult {
    const kept: JavaRuntime[] = [];
    const fixed: FixedRuntime[] = [];
    const removed: JavaRuntime[] = [];

    for (const entry of existing) {
        if (validateRuntime(entry, os)) {
            kept.push({...entry});
            continue;
        }

        if (enableFix) {
            const newPath = fixPath(entry.path, os);
            if (newPath !== undefined) {
                const fixedEntry = {...entry, path: newPath};
                kept.push(fixedEntry);
                fixed.push({entry: fixedEntry, oldPath: entry.path});
                continue;
            }
        }

        removed.push({...entry});
    }

    return {kept, fixed, removed};
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
 * - The `default` flag is solely the user's responsibility; Jaenvtix neither
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
