
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import {buildFullPath, ensureDirectory, findCommonRoot, writeFileWithDirectory} from "../../util/extractorUtils";

const TAR_BLOCK_SIZE = 512;
const TAR_TYPE_FILE = '0';
const TAR_TYPE_DIR = '5';

interface TarEntry {
    name: string;
    type: string;
    size: number;
}

function parseTarHeader(buffer: Buffer): TarEntry | null {
    if (buffer.every(byte => byte === 0)) {
        return null;
    }

    const name = buffer.subarray(0, 100).toString('utf8').replace(/\0/g, '');
    const size = parseInt(buffer.subarray(124, 136).toString('utf8').trim(), 8) || 0;
    const type = buffer.subarray(156, 157).toString('utf8') || TAR_TYPE_FILE;

    return { name, type, size };
}

async function decompressGzip(filePath: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const input = createReadStream(filePath);

    input.pipe(gunzip);

    for await (const chunk of gunzip) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks);
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