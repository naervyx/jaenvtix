import {createReadStream, promises as fs} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {buildFullPath, ensureDirectory, findCommonRoot, writeFileWithDirectory} from '../fileExtractor';

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

    return {name, type, size, mode};
}

/**
 * FIFO byte queue over stream chunks. Lets the TAR reader consume exact byte
 * counts (header blocks, padded entry content) from arbitrarily-sized gunzip
 * chunks without concatenating the whole stream into one buffer.
 */
class ChunkQueue {
    private chunks: Buffer[] = [];
    private totalLength = 0;

    push(chunk: Buffer): void {
        this.chunks.push(chunk);
        this.totalLength += chunk.length;
    }

    /** Removes and returns exactly `count` bytes, or `null` when not enough are buffered yet. */
    take(count: number): Buffer | null {
        if (this.totalLength < count) {
            return null;
        }
        if (count === 0) {
            return Buffer.alloc(0);
        }

        const parts: Buffer[] = [];
        let remaining = count;

        while (remaining > 0) {
            const head = this.chunks[0];
            if (head.length <= remaining) {
                parts.push(head);
                this.chunks.shift();
                remaining -= head.length;
            } else {
                parts.push(head.subarray(0, remaining));
                this.chunks[0] = head.subarray(remaining);
                remaining = 0;
            }
        }

        this.totalLength -= count;
        return parts.length === 1 ? parts[0] : Buffer.concat(parts);
    }

    /** Discards exactly `count` bytes without building a buffer. Returns `false` when not enough are buffered yet. */
    skip(count: number): boolean {
        if (this.totalLength < count) {
            return false;
        }

        let remaining = count;
        while (remaining > 0) {
            const head = this.chunks[0];
            if (head.length <= remaining) {
                this.chunks.shift();
                remaining -= head.length;
            } else {
                this.chunks[0] = head.subarray(remaining);
                remaining = 0;
            }
        }

        this.totalLength -= count;
        return true;
    }
}

/**
 * Streams the gzip-compressed TAR at `sourcePath` and yields one record per
 * entry. When `includeContent` is `false` the entry payload is discarded
 * without buffering (used by the name-collection pass).
 *
 * Stops at the first all-zero header block (end-of-archive marker). Peak
 * memory is a single entry's content plus the small chunk backlog; the
 * decompressed archive is never held in memory as a whole.
 */
async function* readTarEntries(
    sourcePath: string,
    includeContent: boolean,
): AsyncGenerator<{header: TarEntry; content: Buffer | null}> {
    const queue = new ChunkQueue();
    const gunzip = createGunzip();
    const input = createReadStream(sourcePath);

    let pendingHeader: TarEntry | null = null;

    try {
        input.pipe(gunzip);

        for await (const chunk of gunzip) {
            queue.push(chunk as Buffer);

            for (;;) {
                if (!pendingHeader) {
                    const headerBlock = queue.take(TAR_BLOCK_SIZE);
                    if (!headerBlock) {
                        break;
                    }

                    const header = parseTarHeader(headerBlock);
                    if (!header) {
                        return;
                    }
                    pendingHeader = header;
                }

                const paddedSize = Math.ceil(pendingHeader.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

                if (includeContent) {
                    const padded = queue.take(paddedSize);
                    if (!padded) {
                        break;
                    }
                    yield {header: pendingHeader, content: padded.subarray(0, pendingHeader.size)};
                } else {
                    if (!queue.skip(paddedSize)) {
                        break;
                    }
                    yield {header: pendingHeader, content: null};
                }

                pendingHeader = null;
            }
        }
    } finally {
        if (!input.destroyed) {
            input.destroy();
        }
        if (!gunzip.destroyed) {
            gunzip.destroy();
        }
    }
}

/**
 * Extracts a `.tar.gz` archive at `sourcePath` into `destPath`.
 *
 * Business rules:
 * - Two streaming passes over the archive: the first collects entry names to
 *   detect the common root, the second writes files. Gzip is decompressed
 *   twice, trading a little CPU for never holding the whole archive in memory.
 * - Skips PAX metadata entries (`g`, `x`, `L`, `K`, `V` type flags) so that
 *   PAX global headers prepended by Amazon Corretto archives do not interfere
 *   with common-root detection.
 * - Strips a single common root directory when all content entries share one.
 * - Preserves Unix file permissions (`mode` field) via `chmod` on POSIX systems;
 *   on Windows the chmod call is skipped because the field is not meaningful.
 * - A failed `chmod` on a single file is silently ignored; it must not abort
 *   the rest of the extraction.
 */
export async function extractTarGz(sourcePath: string, destPath: string): Promise<void> {
    const entryNames: string[] = [];
    for await (const {header} of readTarEntries(sourcePath, false)) {
        if (isContentEntry(header.type)) {
            entryNames.push(header.name);
        }
    }

    const root = findCommonRoot(entryNames);
    await ensureDirectory(destPath);

    for await (const {header, content} of readTarEntries(sourcePath, true)) {
        const fullPath = buildFullPath(destPath, header.name, root);
        if (!fullPath) {
            continue;
        }

        if (header.type === TAR_TYPE_DIR) {
            await ensureDirectory(fullPath);
            continue;
        }

        if (header.type !== TAR_TYPE_FILE && header.type !== '') {
            continue;
        }

        await writeFileWithDirectory(fullPath, content ?? Buffer.alloc(0));

        if (IS_POSIX && header.mode) {
            try {
                await fs.chmod(fullPath, header.mode & 0o777);
            } catch {
                // Best-effort: a failed chmod on one file must not abort extraction.
            }
        }
    }
}
