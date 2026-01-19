import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';

export async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

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

export function stripRootFromPath(entryPath: string, root: string | null): string {
    if (!root || !entryPath.startsWith(root)) {
        return entryPath;
    }
    return entryPath.slice(root.length);
}

export async function writeFileWithDirectory(fullPath: string, content: Buffer): Promise<void> {
    await ensureDirectory(dirname(fullPath));
    await fs.writeFile(fullPath, content);
}

export function buildFullPath(destPath: string, entryName: string, root: string | null): string | null {
    const strippedName = stripRootFromPath(entryName, root);

    if (!strippedName || strippedName === '/') {
        return null;
    }

    return join(destPath, strippedName);
}