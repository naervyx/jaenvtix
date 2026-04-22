
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

        entries.push(header.name);
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

export async function extractTarGz(sourcePath: string, destPath: string): Promise<void> {
    const buffer = await decompressGzip(sourcePath);
    const entries = collectEntryNames(buffer);
    const root = findCommonRoot(entries);

    await ensureDirectory(destPath);
    await extractEntries(buffer, destPath, root);
}