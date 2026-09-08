import {promises as fs} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import {inflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
import {buildFullPath, ensureDirectory, findCommonRoot, writeFileWithDirectory} from '../fileExtractor';
import {Messages} from '../../util/message';

interface ZipEntry {
    name: string;
    compressedSize: number;
    compressionMethod: number;
    dataOffset: number;
    isDirectory: boolean;
}

const inflateRawAsync = promisify(inflateRaw);

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_SIZE = 30;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_STORE = 0;

/**
 * Reads exactly `length` bytes from `handle` at `position`, or returns `null`
 * when the file ends before `length` bytes are available.
 */
async function readExact(handle: FileHandle, position: number, length: number): Promise<Buffer | null> {
    if (length === 0) {
        return Buffer.alloc(0);
    }

    const buffer = Buffer.alloc(length);
    const {bytesRead} = await handle.read(buffer, 0, length, position);
    return bytesRead === length ? buffer : null;
}

/**
 * Walks sequential local file headers via positioned reads until the signature
 * no longer matches (e.g. the central directory begins). Only headers and file
 * names are read here; entry data stays on disk until extraction.
 */
async function parseZipEntries(handle: FileHandle): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];
    let offset = 0;

    for (;;) {
        const header = Buffer.alloc(LOCAL_FILE_HEADER_SIZE);
        const {bytesRead} = await handle.read(header, 0, LOCAL_FILE_HEADER_SIZE, offset);

        if (bytesRead < LOCAL_FILE_HEADER_SIZE) {
            break;
        }

        const signature = header.readUInt32LE(0);
        if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
            break;
        }

        const compressionMethod = header.readUInt16LE(8);
        const compressedSize = header.readUInt32LE(18);
        const fileNameLength = header.readUInt16LE(26);
        const extraFieldLength = header.readUInt16LE(28);

        const nameBuffer = await readExact(handle, offset + LOCAL_FILE_HEADER_SIZE, fileNameLength);
        if (!nameBuffer) {
            break;
        }

        const name = nameBuffer.toString('utf8');
        const dataOffset = offset + LOCAL_FILE_HEADER_SIZE + fileNameLength + extraFieldLength;

        entries.push({
            name,
            compressedSize,
            compressionMethod,
            dataOffset,
            isDirectory: name.endsWith('/'),
        });

        offset = dataOffset + compressedSize;
    }

    return entries;
}

/** Reads and decompresses a single ZIP entry using STORE (pass-through) or DEFLATE. */
async function decompressEntry(handle: FileHandle, entry: ZipEntry): Promise<Buffer> {
    const compressedData = await readExact(handle, entry.dataOffset, entry.compressedSize) ?? Buffer.alloc(0);

    if (entry.compressionMethod === COMPRESSION_STORE) {
        return compressedData;
    }

    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
        return await inflateRawAsync(compressedData);
    }

    throw new Error(Messages.Error.UNSUPPORTED_ZIP_COMPRESSION(entry.compressionMethod));
}

/** Writes each non-directory entry to `destPath`, skipping unsafe or empty paths. */
async function extractEntries(handle: FileHandle, entries: ZipEntry[], destPath: string, root: string | null): Promise<void> {
    for (const entry of entries) {
        const fullPath = buildFullPath(destPath, entry.name, root);

        if (!fullPath) {
            continue;
        }

        if (entry.isDirectory) {
            await ensureDirectory(fullPath);
        } else {
            const content = await decompressEntry(handle, entry);
            await writeFileWithDirectory(fullPath, content);
        }
    }
}

/**
 * Extracts a ZIP archive at `sourcePath` into `destPath`.
 *
 * Business rules:
 * - Supports STORE (method 0) and DEFLATE (method 8) compression; any other
 *   method throws an error with the unsupported method code.
 * - Strips a single common root directory when all entries share one, so JDK
 *   contents land directly in `destPath` rather than a nested subdirectory.
 * - Uses `buildFullPath` for every entry, which silently skips path-traversal
 *   attempts (entries with `..` components).
 * - Reads entry data on demand via positioned file reads: peak memory is one
 *   entry (compressed + decompressed) instead of the whole archive.
 */
export async function extractZip(sourcePath: string, destPath: string): Promise<void> {
    const handle = await fs.open(sourcePath, 'r');

    try {
        const entries = await parseZipEntries(handle);
        const root = findCommonRoot(entries.map(e => e.name));

        await ensureDirectory(destPath);
        await extractEntries(handle, entries, destPath, root);
    } finally {
        await handle.close();
    }
}
