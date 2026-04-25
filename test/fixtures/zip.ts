export interface ZipFixtureEntry {
    name: string;
    content?: Buffer | string;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const COMPRESSION_STORED = 0;

function asBuffer(content: ZipFixtureEntry['content']): Buffer {
    if (!content) {
        return Buffer.alloc(0);
    }
    return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

function buildLocalFileHeader(entry: ZipFixtureEntry): Buffer {
    const isDirectory = entry.name.endsWith('/');
    const payload = isDirectory ? Buffer.alloc(0) : asBuffer(entry.content);
    const nameBuf = Buffer.from(entry.name, 'utf8');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);                       // version needed
    header.writeUInt16LE(0, 6);                        // flags
    header.writeUInt16LE(COMPRESSION_STORED, 8);       // method
    header.writeUInt16LE(0, 10);                       // mod time
    header.writeUInt16LE(0, 12);                       // mod date
    header.writeUInt32LE(0, 14);                       // crc32 (parser ignores)
    header.writeUInt32LE(payload.length, 18);          // compressed size
    header.writeUInt32LE(payload.length, 22);          // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);          // filename length
    header.writeUInt16LE(0, 28);                       // extra length

    return Buffer.concat([header, nameBuf, payload]);
}

export function buildZipBuffer(entries: ZipFixtureEntry[]): Buffer {
    const blocks = entries.map(buildLocalFileHeader);
    // Trailer: 4 non-signature bytes terminate the parser's LFH walk cleanly.
    blocks.push(Buffer.alloc(4));
    return Buffer.concat(blocks);
}
