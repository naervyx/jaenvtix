import {gzipSync} from 'node:zlib';

export type TarEntryType = 'file' | 'dir' | 'pax-global' | 'pax-extended' | 'gnu-longlink' | 'gnu-longname' | 'symlink';

export interface TarFixtureEntry {
    name: string;
    type?: TarEntryType;
    content?: Buffer | string;
    mode?: number;
    linkName?: string;
}

const TYPE_FLAGS: Record<TarEntryType, string> = {
    file: '0',
    dir: '5',
    symlink: '2',
    'pax-global': 'g',
    'pax-extended': 'x',
    'gnu-longlink': 'K',
    'gnu-longname': 'L',
};

function toOctal(value: number, width: number): string {
    return value.toString(8).padStart(width - 1, '0') + '\0';
}

function writeAscii(buf: Buffer, offset: number, length: number, value: string): void {
    const truncated = value.slice(0, length);
    buf.write(truncated, offset, length, 'utf8');
}

function buildHeader(entry: TarFixtureEntry, size: number): Buffer {
    const header = Buffer.alloc(512);

    writeAscii(header, 0, 100, entry.name);
    writeAscii(header, 100, 8, toOctal(entry.mode ?? 0o644, 8));
    writeAscii(header, 108, 8, toOctal(0, 8));
    writeAscii(header, 116, 8, toOctal(0, 8));
    writeAscii(header, 124, 12, toOctal(size, 12));
    writeAscii(header, 136, 12, toOctal(0, 12));

    // Checksum field starts as 8 spaces (per spec) so it can be summed in.
    header.fill(0x20, 148, 156);

    const typeFlag = TYPE_FLAGS[entry.type ?? 'file'];
    header.write(typeFlag, 156, 1, 'utf8');

    if (entry.linkName) {
        writeAscii(header, 157, 100, entry.linkName);
    }

    writeAscii(header, 257, 6, 'ustar\0');
    writeAscii(header, 263, 2, '00');

    let checksum = 0;
    for (let i = 0; i < 512; i++) {
        checksum += header[i];
    }
    const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.write(checksumStr, 148, 8, 'utf8');

    return header;
}

function padTo512(content: Buffer): Buffer {
    const remainder = content.length % 512;
    if (remainder === 0) {
        return content;
    }
    return Buffer.concat([content, Buffer.alloc(512 - remainder)]);
}

function asBuffer(content: TarFixtureEntry['content']): Buffer {
    if (!content) {
        return Buffer.alloc(0);
    }
    return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

export function buildTarBuffer(entries: TarFixtureEntry[]): Buffer {
    const blocks: Buffer[] = [];

    for (const entry of entries) {
        const payload = entry.type === 'dir' ? Buffer.alloc(0) : asBuffer(entry.content);
        blocks.push(buildHeader(entry, payload.length));
        if (payload.length > 0) {
            blocks.push(padTo512(payload));
        }
    }

    // End-of-archive: two consecutive zero blocks.
    blocks.push(Buffer.alloc(1024));

    return Buffer.concat(blocks);
}

export function buildTarGzBuffer(entries: TarFixtureEntry[]): Buffer {
    return gzipSync(buildTarBuffer(entries));
}
