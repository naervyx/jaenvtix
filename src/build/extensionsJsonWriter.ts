import {dirname} from 'node:path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';

interface ExtensionsJson {
    recommendations?: unknown;
    [key: string]: unknown;
}

export interface ExtensionsJsonUpdateResult {
    updated: boolean;
    /** Marketplace IDs appended by this run (existing ones are never listed). */
    added: string[];
}

/**
 * Reads and parses `.vscode/extensions.json`. Recovers from a missing or
 * malformed file by returning an empty object — recommendations are additive
 * data, so resetting a broken file loses nothing Jaenvtix cannot rewrite.
 */
function readExtensionsJson(extensionsJsonPath: string): ExtensionsJson {
    if (!existsSync(extensionsJsonPath)) {
        return {};
    }

    try {
        const parsed: unknown = JSON.parse(readFileSync(extensionsJsonPath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as ExtensionsJson;
        }
        return {};
    } catch {
        return {};
    }
}

/**
 * Merges `recommendedIds` into the `recommendations` array of the workspace
 * `.vscode/extensions.json` — VS Code's native mechanism for suggesting
 * extensions to anyone who opens the folder.
 *
 * Business rules:
 * - Existing entries are preserved verbatim, in their original order; new
 *   IDs are appended after them.
 * - Duplicate detection is case-insensitive (marketplace IDs are
 *   case-insensitive, and hand-edited files often vary casing).
 * - All other keys in the file (e.g. `unwantedRecommendations`) are
 *   untouched.
 * - Creates `.vscode/` when missing; returns `updated: false` on no-ops so
 *   re-runs don't bump mtimes.
 */
export function updateExtensionsJson(
    extensionsJsonPath: string,
    recommendedIds: readonly string[],
): ExtensionsJsonUpdateResult {
    const data = readExtensionsJson(extensionsJsonPath);

    const existing = Array.isArray(data.recommendations)
        ? data.recommendations.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const existingLower = new Set(existing.map((id) => id.toLowerCase()));

    const added: string[] = [];
    for (const id of recommendedIds) {
        if (!existingLower.has(id.toLowerCase())) {
            added.push(id);
            existingLower.add(id.toLowerCase());
        }
    }

    if (added.length === 0) {
        return {updated: false, added: []};
    }

    data.recommendations = [...existing, ...added];

    const dirPath = dirname(extensionsJsonPath);
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, {recursive: true});
    }

    writeFileSync(extensionsJsonPath, JSON.stringify(data, null, 4), 'utf-8');
    return {updated: true, added};
}
