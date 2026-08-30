import {promises as fs} from 'node:fs';
import {join, dirname, resolve, relative, isAbsolute, sep} from 'node:path';

/** Creates `dirPath` and all missing ancestor directories (idempotent). */
export async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, {recursive: true});
}

/**
 * Canonicalizes an archive entry name: converts backslashes to forward slashes
 * and strips a single leading `./`.
 *
 * The `./` prefix is a no-op ("current directory") that some tar producers add
 * to every entry, notably Oracle JDK *macOS* archives, whose entries look like
 * `./jdk-21.0.11.jdk/Contents/Home/...`. Left in place it defeats common-root
 * detection: `findCommonRoot` would see `.` as the shared root and strip only
 * `./`, nesting the JDK one level too deep (`<jdkHome>/jdk-21.0.11.jdk/...`) and
 * leaving no `bin/java` where the pipeline expects one. Both the root-detection
 * pass and the per-entry path build must apply the same normalization, or the
 * detected root and the entry paths disagree.
 */
function normalizeEntryName(entryName: string): string {
    const forwardSlashed = entryName.replace(/\\/g, '/');
    return forwardSlashed.startsWith('./') ? forwardSlashed.slice(2) : forwardSlashed;
}

/**
 * Detects the single common root directory that every entry in an archive
 * shares, if one exists.
 *
 * Business rules:
 * - Entry names are normalized via `normalizeEntryName` first, so a leading
 *   `./` prefix (Oracle macOS archives) does not mask the real root.
 * - Returns `null` when the list is empty or entries have different top-level
 *   directories (no single root to strip).
 * - Returns `root + '/'` only when every non-root entry is nested under that
 *   root, so it is safe to strip the prefix without collapsing siblings.
 * - Used by the ZIP and TAR.GZ extractors to flatten single-root archives so
 *   the JDK lands directly in `<jdkHome>/` rather than `<jdkHome>/jdk-21.0.3/`.
 */
export function findCommonRoot(entryNames: string[]): string | null {
    const normalized = entryNames
        .map(normalizeEntryName)
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

/**
 * Writes `content` to `fullPath`, creating any missing ancestor directories first.
 *
 * Business rules:
 * - Overwrites read-only files left by a previous extraction: JDK archives
 *   ship `legal/**` entries with mode 0444, and the extractors preserve that
 *   mode on disk. Opening such a file for writing fails with `EACCES` (POSIX)
 *   or `EPERM` (Windows) even for the file's owner, so on those codes the
 *   file is made writable and the write retried once. The TAR extractor
 *   re-applies the archive's mode afterwards, restoring the read-only bit.
 * - Any other write error, and any failure of the retry itself (e.g. the
 *   denial comes from directory permissions), propagates to the caller.
 */
export async function writeFileWithDirectory(fullPath: string, content: Buffer): Promise<void> {
    await ensureDirectory(dirname(fullPath));
    try {
        await fs.writeFile(fullPath, content);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EACCES' && code !== 'EPERM') {
            throw error;
        }
        await fs.chmod(fullPath, 0o666);
        await fs.writeFile(fullPath, content);
    }
}

/**
 * Resolves the absolute destination path for a single archive entry, stripping
 * the common root prefix when present.
 *
 * Business rules:
 * - Normalizes the entry name via `normalizeEntryName` (forward slashes, no
 *   leading `./`) so root stripping matches the root computed by
 *   `findCommonRoot`, which normalizes the same way.
 * - Returns `null` for directory entries (trailing `/`), empty names, and absolute
 *   entry paths; these are skipped by the caller.
 * - Guards against path traversal attacks: if the resolved path escapes `destPath`
 *   (i.e. the relative path starts with `..`), returns `null` and the entry is
 *   silently skipped rather than written outside the destination directory.
 */
export function buildFullPath(destPath: string, entryName: string, root: string | null): string | null {
    const strippedName = stripRootFromPath(normalizeEntryName(entryName), root);

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