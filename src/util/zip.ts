import { promises as fs } from 'node:fs';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import {buildFullPath, ensureDirectory, findCommonRoot, writeFileWithDirectory} from "./extractorUtils";
import {Messages} from './message';

const inflateRawAsync = promisify(inflateRaw);

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_STORE = 0;

interface ZipEntry {
    name: string;
    compressedSize: number;
    compressionMethod: number;
    dataOffset: number;
    isDirectory: boolean;
}

function parseZipEntries(buffer: Buffer): ZipEntry[] {
    const entries: ZipEntry[] = [];
    let offset = 0;

    while (offset < buffer.length - 4) {
        const signature = buffer.readUInt32LE(offset);

        if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
            break;
        }

        const compressionMethod = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const fileNameLength = buffer.readUInt16LE(offset + 26);
        const extraFieldLength = buffer.readUInt16LE(offset + 28);

        const nameStart = offset + 30;
        const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
        const dataOffset = nameStart + fileNameLength + extraFieldLength;

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

async function decompressEntry(buffer: Buffer, entry: ZipEntry): Promise<Buffer> {
    const compressedData = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);

    if (entry.compressionMethod === COMPRESSION_STORE) {
        return compressedData;
    }

    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
        return await inflateRawAsync(compressedData);
    }

    throw new Error(Messages.Error.UNSUPPORTED_ZIP_COMPRESSION(entry.compressionMethod));
}

async function extractEntries(buffer: Buffer, entries: ZipEntry[], destPath: string, root: string | null): Promise<void> {
    for (const entry of entries) {
        const fullPath = buildFullPath(destPath, entry.name, root);

        if (!fullPath) {
            continue;
        }

        if (entry.isDirectory) {
            await ensureDirectory(fullPath);
        } else {
            const content = await decompressEntry(buffer, entry);
            await writeFileWithDirectory(fullPath, content);
        }
    }
}

export async function extractZip(sourcePath: string, destPath: string): Promise<void> {
    const buffer = await fs.readFile(sourcePath);
    const entries = parseZipEntries(buffer);
    const root = findCommonRoot(entries.map(e => e.name));

    await ensureDirectory(destPath);
    await extractEntries(buffer, entries, destPath, root);
}
