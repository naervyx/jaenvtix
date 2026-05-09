
import { createReadStream, promises as fs } from 'node:fs';
import { createGunzip } from 'node:zlib';
import {buildFullPath, ensureDirectory, findCommonRoot, writeFileWithDirectory} from "../fileExtractor";

interface TarEntry {
    name: string;
    type: string;
    size: number;
    mode: number;
}

const TAR_BLOCK_SIZE = 512;
const TAR_TYPE_FILE = '0';
const TAR_TYPE_DIR = '5';
const IS_POSIX = process.platform !== 'win32';

/**
 * TAR entry type flags that represent metadata rather than extractable content.
 * Several Linux/macOS JDK distributions (notably Amazon Corretto 11/17) prepend
 * a PAX global header (`g`) to the archive. Including its name in root detection
 * causes `findCommonRoot` to return `null`, so the JDK ends up nested under
 * `<jdkHome>/amazon-corretto-…/` instead of being flattened directly into `<jdkHome>/`.
 * Filtering these out before calling `findCommonRoot` prevents that mis-nesting.
 */
const TAR_METADATA_TYPES = new Set(['g', 'x', 'L', 'K', 'V']);

function isContentEntry(type: string): boolean {
    return !TAR_METADATA_TYPES.has(type);
}

function parseOctalField(buffer: Buffer): number {
    const text = buffer.toString('utf8').replace(/\0/g, '').trim();
    if (!text) {
        return 0;
    }
    const parsed = parseInt(text, 8);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseTarHeader(buffer: Buffer): TarEntry | null {
    if (buffer.every(byte => byte === 0)) {
        return null;
    }

    const name = buffer.subarray(0, 100).toString('utf8').replace(/\0/g, '');
    const mode = parseOctalField(buffer.subarray(100, 108));
    const size = parseOctalField(buffer.subarray(124, 136));
    const type = buffer.subarray(156, 157).toString('utf8') || TAR_TYPE_FILE;

    return { name, type, size, mode };
}

async function decompressGzip(filePath: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const input = createReadStream(filePath);

    try {
        input.pipe(gunzip);

        for await (const chunk of gunzip) {
            chunks.push(chunk as Buffer);
        }

        return Buffer.concat(chunks);
    } finally {
        if (!input.destroyed) {
            input.destroy();
        }
        if (!gunzip.destroyed) {
            gunzip.destroy();
        }
    }
}

function collectEntryNames(buffer: Buffer): string[] {
    const entries: string[] = [];
    let offset = 0;

    while (offset < buffer.length) {
        const header = parseTarHeader(buffer.subarray(offset, offset + TAR_BLOCK_SIZE));
        if (!header) {
            break;
        }

        if (isContentEntry(header.type)) {
            entries.push(header.name);
        }
        offset += TAR_BLOCK_SIZE;
        offset += Math.ceil(header.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }

    return entries;
}

async function extractEntries(buffer: Buffer, destPath: string, root: string | null): Promise<void> {
    let offset = 0;

    while (offset < buffer.length) {
        const header = parseTarHeader(buffer.subarray(offset, offset + TAR_BLOCK_SIZE));
        if (!header) {
            break;
        }

        offset += TAR_BLOCK_SIZE;
        const fullPath = buildFullPath(destPath, header.name, root);

        if (fullPath) {
            if (header.type === TAR_TYPE_DIR) {
                await ensureDirectory(fullPath);
            } else if (header.type === TAR_TYPE_FILE || header.type === '') {
                const content = buffer.subarray(offset, offset + header.size);
                await writeFileWithDirectory(fullPath, content);

                if (IS_POSIX && header.mode) {
                    try {
                        await fs.chmod(fullPath, header.mode & 0o777);
                    } catch {
                        // Best-effort: a failed chmod on one file must not abort extraction.
                    }
                }
            }
        }

        offset += Math.ceil(header.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }
}

/**
 * Extracts a `.tar.gz` archive at `sourcePath` into `destPath`.
 *
 * Business rules:
 * - Decompresses the gzip layer first, then parses the resulting TAR stream
 *   entirely in memory.
 * - Skips PAX metadata entries (`g`, `x`, `L`, `K`, `V` type flags) so that
 *   PAX global headers prepended by Amazon Corretto archives do not interfere
 *   with common-root detection.
 * - Strips a single common root directory when all content entries share one.
 * - Preserves Unix file permissions (`mode` field) via `chmod` on POSIX systems;
 *   on Windows the chmod call is skipped because the field is not meaningful.
 * - A failed `chmod` on a single file is silently ignored — it must not abort
 *   the rest of the extraction.
 */
export async function extractTarGz(sourcePath: string, destPath: string): Promise<void> {
    const buffer = await decompressGzip(sourcePath);
    const entries = collectEntryNames(buffer);
    const root = findCommonRoot(entries);

    await ensureDirectory(destPath);
    await extractEntries(buffer, destPath, root);
}