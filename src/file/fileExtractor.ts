import {promises as fs} from 'node:fs';
import {join, dirname, resolve, relative, isAbsolute, sep} from 'node:path';

/** Creates `dirPath` and all missing ancestor directories (idempotent). */
export async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, {recursive: true});
}

/**
 * Detects the single common root directory that every entry in an archive
 * shares, if one exists.
 *
 * Business rules:
 * - Returns `null` when the list is empty or entries have different top-level
 *   directories (no single root to strip).
 * - Returns `root + '/'` only when every non-root entry is nested under that
 *   root — i.e., it is safe to strip the prefix without collapsing siblings.
 * - Used by the ZIP and TAR.GZ extractors to flatten single-root archives so
 *   the JDK lands directly in `<jdkHome>/` rather than `<jdkHome>/jdk-21.0.3/`.
 */
export function findCommonRoot(entryNames: string[]): string | null {
    const normalized = entryNames
        .map(p => p.replace(/\\/g, '/'))
        .filter(p => p.length > 0);

    if (normalized.length === 0) {
        return null;
    }

    const roots = new Set(normalized.map(p => p.split('/')[0]));

    if (roots.size !== 1) {
        return null;
    }

    const root = [...roots][0];
    const allNested = normalized.every(p => p.includes('/') || p === root + '/');

    return allNested ? root + '/' : null;
}

/**
 * Removes the common `root` prefix from `entryPath`.
 * Returns `entryPath` unchanged when `root` is `null` or the path does not start with it.
 */
export function stripRootFromPath(entryPath: string, root: string | null): string {
    if (!root || !entryPath.startsWith(root)) {
        return entryPath;
    }
    return entryPath.slice(root.length);
}

/** Writes `content` to `fullPath`, creating any missing ancestor directories first. */
export async function writeFileWithDirectory(fullPath: string, content: Buffer): Promise<void> {
    await ensureDirectory(dirname(fullPath));
    await fs.writeFile(fullPath, content);
}

/**
 * Resolves the absolute destination path for a single archive entry, stripping
 * the common root prefix when present.
 *
 * Business rules:
 * - Returns `null` for directory entries (trailing `/`), empty names, and absolute
 *   entry paths — these are skipped by the caller.
 * - Guards against path traversal attacks: if the resolved path escapes `destPath`
 *   (i.e. the relative path starts with `..`), returns `null` and the entry is
 *   silently skipped rather than written outside the destination directory.
 */
export function buildFullPath(destPath: string, entryName: string, root: string | null): string | null {
    const strippedName = stripRootFromPath(entryName, root);

    if (!strippedName || strippedName === '/') {
        return null;
    }

    if (isAbsolute(strippedName)) {
        return null;
    }

    const resolvedDest = resolve(destPath);
    const candidate = resolve(resolvedDest, strippedName);
    const relativePath = relative(resolvedDest, candidate);

    if (relativePath.startsWith('..' + sep) || relativePath === '..' || isAbsolute(relativePath)) {
        return null;
    }

    return join(destPath, strippedName);
}