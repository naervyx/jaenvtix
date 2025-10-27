import * as assert from "assert";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { extract, setManualExtractionPrompt, setSpawnImplementation } from "../modules/extractor";

const shouldSkipIntegration = process.env.JAENVTIX_SKIP_INTEGRATION_TESTS === "1";
const integrationSuite = shouldSkipIntegration ? suite.skip : suite;

interface ZipEntrySpec {
    readonly name: string;
    readonly data?: Buffer;
    readonly isDirectory?: boolean;
    readonly externalAttributes?: number;
}

interface TarEntrySpec {
    readonly name: string;
    readonly data?: Buffer;
    readonly type?: "file" | "directory";
}

integrationSuite("extractor", () => {
    teardown(async () => {
        setSpawnImplementation(undefined);
        setManualExtractionPrompt(undefined);
    });

    test("extracts ZIP archives using JavaScript fallback", async () => {
        const tempDir = await createTempDirectory();
        const archivePath = path.join(tempDir, "archive.zip");
        const destination = path.join(tempDir, "output");
        const archive = createZipArchive([
            { name: "file.txt", data: Buffer.from("zip-content") },
            { name: "folder/", isDirectory: true },
            { name: "folder/nested.txt", data: Buffer.from("nested") },
        ]);

        await fs.writeFile(archivePath, archive);
        setSpawnImplementation(createFailingSpawn());
        setManualExtractionPrompt(async () => undefined);

        try {
            const result = await extract(archivePath, destination);
            const nestedPath = path.join(destination, "folder", "nested.txt");
            const nestedContent = await fs.readFile(nestedPath, "utf8");

            assert.strictEqual(result, path.resolve(destination));
            assert.strictEqual(nestedContent, "nested");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("rejects ZIP archives containing symbolic links", async () => {
        const tempDir = await createTempDirectory();
        const archivePath = path.join(tempDir, "symlink.zip");
        const destination = path.join(tempDir, "output");
        const archive = createZipArchive([
            {
                name: "link",
                data: Buffer.from("../escape"),
                externalAttributes: (0o120000 << 16) >>> 0,
            },
        ]);

        await fs.writeFile(archivePath, archive);
        setSpawnImplementation((() => {
            throw new Error("Native extraction should not be invoked for unsafe entries");
        }) as unknown as typeof spawn);
        setManualExtractionPrompt(async () => undefined);

        try {
            await assert.rejects(
                async () => extract(archivePath, destination, "zip"),
                /Symbolic link entries are not supported/,
            );
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("extracts TAR archives using JavaScript fallback", async () => {
        const tempDir = await createTempDirectory();
        const archivePath = path.join(tempDir, "archive.tar");
        const destination = path.join(tempDir, "output");
        const archive = createTarArchive([
            { name: "folder/", type: "directory" },
            { name: "folder/data.txt", data: Buffer.from("tar-data"), type: "file" },
        ]);

        await fs.writeFile(archivePath, archive);
        setSpawnImplementation(createFailingSpawn());
        setManualExtractionPrompt(async () => undefined);

        try {
            const result = await extract(archivePath, destination);
            const filePath = path.join(destination, "folder", "data.txt");
            const fileContent = await fs.readFile(filePath, "utf8");

            assert.strictEqual(result, path.resolve(destination));
            assert.strictEqual(fileContent, "tar-data");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("uses manual fallback when extraction repeatedly fails", async () => {
        const tempDir = await createTempDirectory();
        const archivePath = path.join(tempDir, "corrupted.zip");
        const destination = path.join(tempDir, "output");
        const manualPath = path.join(tempDir, "manual");

        await fs.writeFile(archivePath, Buffer.from("invalid"));
        await fs.mkdir(manualPath, { recursive: true });
        setSpawnImplementation(createFailingSpawn());
        let promptInvocations = 0;
        setManualExtractionPrompt(async () => {
            promptInvocations += 1;
            return manualPath;
        });

        try {
            const result = await extract(archivePath, destination, "zip");

            assert.strictEqual(result, path.resolve(manualPath));
            assert.strictEqual(promptInvocations, 1);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test("throws aggregate error when manual fallback is declined", async () => {
        const tempDir = await createTempDirectory();
        const archivePath = path.join(tempDir, "broken.tar");
        const destination = path.join(tempDir, "output");

        await fs.writeFile(archivePath, Buffer.from("broken"));
        setSpawnImplementation(createFailingSpawn());
        let promptInvocations = 0;
        setManualExtractionPrompt(async () => {
            promptInvocations += 1;
            return undefined;
        });

        try {
            await assert.rejects(async () => extract(archivePath, destination, "tar"), /Failed to extract archive/);
            assert.strictEqual(promptInvocations, 1);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});

async function createTempDirectory(): Promise<string> {
    const prefix = path.join(os.tmpdir(), "jaenvtix-extractor-test-");

    return fs.mkdtemp(prefix);
}

function createFailingSpawn(): typeof spawn {
    return ((command: string, _args?: readonly string[], _options?: SpawnOptions) => {
        const child = new EventEmitter() as unknown as ChildProcess;
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();

        Object.assign(child, {
            stdin,
            stdout,
            stderr,
            stdio: [stdin, stdout, stderr] as unknown,
        });

        process.nextTick(() => {
            child.emit("error", new Error(`Native command blocked during test: ${command}`));
        });

        return child;
    }) as unknown as typeof spawn;
}

function createZipArchive(entries: ZipEntrySpec[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const fileName = Buffer.from(entry.name, "utf8");
        const data = entry.isDirectory ? Buffer.alloc(0) : entry.data ?? Buffer.alloc(0);
        const crc = computeCrc32(data);
        const localHeader = Buffer.alloc(30);
        const generalPurpose = 0;
        const compressionMethod = 0;

        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(generalPurpose, 6);
        localHeader.writeUInt16LE(compressionMethod, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc >>> 0, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(fileName.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, fileName, data);

        const centralHeader = Buffer.alloc(46);
        const externalAttributes = entry.externalAttributes ?? (entry.isDirectory ? 0x10 : 0);

        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(generalPurpose, 8);
        centralHeader.writeUInt16LE(compressionMethod, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc >>> 0, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(fileName.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(externalAttributes, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, fileName);
        offset += localHeader.length + fileName.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const localSection = Buffer.concat(localParts);
    const endRecord = Buffer.alloc(22);

    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(localSection.length, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([localSection, centralDirectory, endRecord]);
}

function computeCrc32(data: Buffer): number {
    let crc = 0xffffffff;

    for (const byte of data) {
        const lookup = CRC_TABLE[(crc ^ byte) & 0xff]!;

        crc = lookup ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = createCrcTable();

function createCrcTable(): Uint32Array {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;

        for (let bit = 0; bit < 8; bit += 1) {
            if ((value & 1) !== 0) {
                value = 0xedb88320 ^ (value >>> 1);
            } else {
                value >>>= 1;
            }
        }

        table[index] = value >>> 0;
    }

    return table;
}

function createTarArchive(entries: TarEntrySpec[]): Buffer {
    const blockSize = 512;
    const chunks: Buffer[] = [];

    for (const entry of entries) {
        const isDirectory = entry.type === "directory" || entry.name.endsWith("/");
        const data = isDirectory ? Buffer.alloc(0) : entry.data ?? Buffer.alloc(0);
        const header = Buffer.alloc(blockSize, 0);

        writeTarString(header, 0, 100, entry.name);
        writeTarOctal(header, 100, 8, 0o777);
        writeTarOctal(header, 108, 8, 0);
        writeTarOctal(header, 116, 8, 0);
        writeTarOctal(header, 124, 12, data.length);
        writeTarOctal(header, 136, 12, 0);
        header[156] = isDirectory ? 53 : 48;
        header.write("ustar\0", 257, "ascii");
        header.write("00", 263, "ascii");

        for (let index = 0; index < 8; index += 1) {
            header[148 + index] = 0x20;
        }

        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        writeTarOctal(header, 148, 7, checksum);
        header[155] = 0;

        chunks.push(header);

        if (!isDirectory && data.length > 0) {
            chunks.push(data);
            const padding = (blockSize - (data.length % blockSize)) % blockSize;

            if (padding > 0) {
                chunks.push(Buffer.alloc(padding, 0));
            }
        }
    }

    chunks.push(Buffer.alloc(blockSize, 0));
    chunks.push(Buffer.alloc(blockSize, 0));

    return Buffer.concat(chunks);
}

function writeTarString(buffer: Buffer, start: number, length: number, value: string): void {
    const data = Buffer.from(value, "utf8");
    const slice = data.subarray(0, length - 1);
    slice.copy(buffer, start);
    buffer[start + slice.length] = 0;
}

function writeTarOctal(buffer: Buffer, start: number, length: number, value: number): void {
    const octal = value.toString(8);
    const padded = octal.padStart(length - 1, "0");
    buffer.write(padded, start, length - 1, "ascii");
    buffer[start + length - 1] = 0;
}
