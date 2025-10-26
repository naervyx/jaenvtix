import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import * as path from "node:path";
import { gunzip as gunzipCallback, inflateRaw as inflateRawCallback } from "node:zlib";

const { mkdir, rm, stat, readFile, writeFile, mkdtemp, readdir, rename, chmod } = fsPromises;

export type ArchiveFormat = "zip" | "tar" | "tar.gz";

type SpawnFunction = typeof defaultSpawn;

type ManualExtractionPrompt = (context: ManualExtractionPromptContext) => Promise<string | undefined>;

export interface ManualExtractionPromptContext {
    readonly archivePath: string;
    readonly destination: string;
    readonly errors: readonly Error[];
}

let spawnImplementation: SpawnFunction = defaultSpawn;
let manualPromptImplementation: ManualExtractionPrompt | undefined;

export function setSpawnImplementation(implementation: SpawnFunction | undefined): void {
    spawnImplementation = implementation ?? defaultSpawn;
}

export function setManualExtractionPrompt(prompt: ManualExtractionPrompt | undefined): void {
    manualPromptImplementation = prompt;
}

export async function extract(
    archivePath: string,
    destination: string,
    formatHint?: string,
): Promise<string> {
    const format = detectArchiveFormat(archivePath, formatHint);
    const normalizedDestination = path.resolve(destination);
    const errors: Error[] = [];

    await ensureDirectory(normalizedDestination);

    try {
        await tryNativeExtraction(archivePath, normalizedDestination, format);

        return normalizedDestination;
    } catch (error) {
        errors.push(wrapError("Native extraction failed", error));
    }

    try {
        await tryJavaScriptExtraction(archivePath, normalizedDestination, format);

        return normalizedDestination;
    } catch (error) {
        errors.push(wrapError("JavaScript extraction failed", error));
    }

    try {
        const manualPath = await attemptManualFallback({
            archivePath,
            destination: normalizedDestination,
            errors: errors.slice(),
        });

        if (manualPath) {
            return manualPath;
        }

        errors.push(new Error("Manual extraction path was not provided."));
    } catch (error) {
        errors.push(wrapError("Manual extraction failed", error));
    }

    throw createAggregateExtractionError(archivePath, errors);
}

function detectArchiveFormat(archivePath: string, formatHint?: string): ArchiveFormat {
    const normalizedHint = normalizeFormat(formatHint);

    if (normalizedHint) {
        return normalizedHint;
    }

    const lowerCasePath = archivePath.toLowerCase();

    if (lowerCasePath.endsWith(".tar.gz") || lowerCasePath.endsWith(".tgz")) {
        return "tar.gz";
    }

    if (lowerCasePath.endsWith(".tar")) {
        return "tar";
    }

    if (lowerCasePath.endsWith(".zip")) {
        return "zip";
    }

    throw new Error(`Unable to detect archive format for ${archivePath}.`);
}

function normalizeFormat(value: string | undefined): ArchiveFormat | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();

    if (!normalized) {
        return undefined;
    }

    switch (normalized) {
        case "zip":
            return "zip";
        case "tar":
            return "tar";
        case "tar.gz":
        case "targz":
        case "tgz":
            return "tar.gz";
        default:
            return undefined;
    }
}

async function tryNativeExtraction(
    archivePath: string,
    destination: string,
    format: ArchiveFormat,
): Promise<void> {
    await withTemporaryDirectory(destination, async (workingDirectory) => {
        await validateArchiveEntries(archivePath, format, workingDirectory);

        const command = buildNativeCommand(archivePath, workingDirectory, format);
        const child = (command.options
            ? spawnImplementation(command.command, command.args, command.options)
            : spawnImplementation(command.command, command.args)) as ChildProcess;

        await new Promise<void>((resolve, reject) => {
            child.once("error", (error: Error) => {
                reject(error);
            });
            child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
                if (code === 0) {
                    resolve();
                    return;
                }

                const codeDescription = code !== null ? code : "unknown";
                const signalDescription = signal ? ` (signal ${signal})` : "";

                reject(new Error(`Native extractor exited with code ${codeDescription}${signalDescription}`));
            });
        });

        await moveDirectoryContents(workingDirectory, destination);
    });
}

interface NativeCommand {
    readonly command: string;
    readonly args: readonly string[];
    readonly options?: SpawnOptions;
}

function buildNativeCommand(
    archivePath: string,
    destination: string,
    format: ArchiveFormat,
): NativeCommand {
    const platform = process.platform;

    if (platform === "win32") {
        if (format === "zip") {
            const escapedSource = escapeForPowerShell(archivePath);
            const escapedDestination = escapeForPowerShell(destination);

            return {
                command: "powershell.exe",
                args: [
                    "-NoProfile",
                    "-Command",
                    `Expand-Archive -LiteralPath '${escapedSource}' -DestinationPath '${escapedDestination}' -Force`,
                ],
                options: { stdio: "ignore" },
            };
        }

        if (format === "tar" || format === "tar.gz") {
            return {
                command: "tar",
                args: ["-xf", archivePath, "-C", destination],
                options: { stdio: "ignore" },
            };
        }
    } else {
        if (format === "zip") {
            return {
                command: "unzip",
                args: ["-qq", "-d", destination, "--", archivePath],
                options: { stdio: "ignore" },
            };
        }

        if (format === "tar") {
            return {
                command: "tar",
                args: ["-xf", archivePath, "-C", destination],
                options: { stdio: "ignore" },
            };
        }

        if (format === "tar.gz") {
            return {
                command: "tar",
                args: ["-xzf", archivePath, "-C", destination],
                options: { stdio: "ignore" },
            };
        }
    }

    throw new Error(`No native extraction strategy available for format ${format} on ${platform}.`);
}

function escapeForPowerShell(value: string): string {
    return value.replace(/'/g, "''");
}

async function tryJavaScriptExtraction(
    archivePath: string,
    destination: string,
    format: ArchiveFormat,
): Promise<void> {
    await withTemporaryDirectory(destination, async (workingDirectory) => {
        await performJavaScriptExtraction(archivePath, workingDirectory, format);
        await moveDirectoryContents(workingDirectory, destination);
    });
}

async function performJavaScriptExtraction(
    archivePath: string,
    destination: string,
    format: ArchiveFormat,
): Promise<void> {
    if (format === "zip") {
        await extractZipArchive(archivePath, destination);

        return;
    }

    if (format === "tar") {
        const tarData = await readFile(archivePath);
        await extractTarArchive(tarData, destination);

        return;
    }

    if (format === "tar.gz") {
        const compressed = await readFile(archivePath);
        const decompressed = await gunzipAsync(compressed);
        await extractTarArchive(decompressed, destination);

        return;
    }

    throw new Error(`Unsupported archive format: ${format}`);
}

async function validateArchiveEntries(
    archivePath: string,
    format: ArchiveFormat,
    destination: string,
): Promise<void> {
    if (format === "zip") {
        const buffer = await readFile(archivePath);
        const entries = parseCentralDirectory(buffer);

        for (const entry of entries) {
            validateNativeEntryName(entry.fileName);
            ensureEntrySupported(entry);
            resolveEntryPath(destination, entry.fileName);
        }

        return;
    }

    if (format === "tar") {
        const buffer = await readFile(archivePath);
        validateTarArchive(buffer, destination);

        return;
    }

    if (format === "tar.gz") {
        const compressed = await readFile(archivePath);
        const decompressed = await gunzipAsync(compressed);
        validateTarArchive(decompressed, destination);

        return;
    }

    throw new Error(`Unsupported archive format: ${format}`);
}

async function extractZipArchive(archivePath: string, destination: string): Promise<void> {
    const buffer = await readFile(archivePath);
    const entries = parseCentralDirectory(buffer);
    const destinationRoot = path.resolve(destination);

    for (const entry of entries) {
        ensureEntrySupported(entry);

        const targetPath = resolveEntryPath(destinationRoot, entry.fileName);
        const mode = deriveZipEntryMode(entry);

        if (!targetPath) {
            continue;
        }

        if (entry.isDirectory) {
            await mkdir(targetPath.absolutePath, { recursive: true });
            if (mode !== undefined) {
                await chmod(targetPath.absolutePath, mode);
            }
            continue;
        }

        const fileData = await extractZipEntryData(buffer, entry);
        await mkdir(path.dirname(targetPath.absolutePath), { recursive: true });
        await writeFile(targetPath.absolutePath, fileData);
        if (mode !== undefined) {
            await chmod(targetPath.absolutePath, mode);
        }
    }
}

interface ZipCentralDirectoryEntry {
    readonly fileName: string;
    readonly compressionMethod: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly generalPurposeFlag: number;
    readonly externalAttributes: number;
    readonly localHeaderOffset: number;
    readonly isDirectory: boolean;
}

function parseCentralDirectory(buffer: Buffer): ZipCentralDirectoryEntry[] {
    const endRecord = locateEndOfCentralDirectory(buffer);
    const totalEntries = buffer.readUInt16LE(endRecord + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(endRecord + 16);
    const entries: ZipCentralDirectoryEntry[] = [];
    let offset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
        const signature = buffer.readUInt32LE(offset);

        if (signature !== 0x02014b50) {
            throw new Error("Invalid ZIP central directory signature.");
        }

        const generalPurposeFlag = buffer.readUInt16LE(offset + 8);
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraFieldLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const externalAttributes = buffer.readUInt32LE(offset + 38);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const fileNameStart = offset + 46;
        const fileNameEnd = fileNameStart + fileNameLength;
        const fileName = buffer.toString("utf8", fileNameStart, fileNameEnd);
        const isDirectory = detectZipDirectory(fileName, externalAttributes);

        entries.push({
            fileName,
            compressionMethod,
            compressedSize,
            uncompressedSize,
            generalPurposeFlag,
            externalAttributes,
            localHeaderOffset,
            isDirectory,
        });

        offset = fileNameEnd + extraFieldLength + commentLength;
    }

    return entries;
}

function locateEndOfCentralDirectory(buffer: Buffer): number {
    const minimumSize = 22;
    const signature = 0x06054b50;
    const maximumCommentLength = 0x10000;
    const startOffset = Math.max(0, buffer.length - maximumCommentLength - minimumSize);

    for (let offset = buffer.length - minimumSize; offset >= startOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === signature) {
            return offset;
        }
    }

    throw new Error("Unable to locate the ZIP end of central directory record.");
}

function detectZipDirectory(fileName: string, externalAttributes: number): boolean {
    if (fileName.endsWith("/") || fileName.endsWith("\\")) {
        return true;
    }

    const fileType = (externalAttributes >>> 16) & 0o170000;

    return fileType === 0o040000 || (externalAttributes & 0x10) !== 0;
}

function normalizeFileMode(mode: number | null | undefined): number | undefined {
    if (mode === null || mode === undefined) {
        return undefined;
    }

    const normalized = mode & 0o7777;

    if (normalized === 0) {
        return undefined;
    }

    return normalized;
}

function ensureEntrySupported(entry: ZipCentralDirectoryEntry): void {
    if (entry.generalPurposeFlag & 0x01) {
        throw new Error(`Encrypted ZIP entries are not supported: ${entry.fileName}`);
    }

    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.fileName}`);
    }

    const fileType = (entry.externalAttributes >>> 16) & 0o170000;

    if (fileType === 0o120000) {
        throw new Error(`Symbolic link entries are not supported: ${entry.fileName}`);
    }
}

function deriveZipEntryMode(entry: ZipCentralDirectoryEntry): number | undefined {
    const attributes = entry.externalAttributes >>> 16;

    return normalizeFileMode(attributes);
}

interface ResolvedEntryPath {
    readonly absolutePath: string;
}

function resolveEntryPath(destinationRoot: string, entryName: string): ResolvedEntryPath | undefined {
    const normalized = normalizeEntryName(entryName);

    if (!normalized) {
        return undefined;
    }

    const absolute = path.resolve(destinationRoot, normalized);
    const normalizedDestination = ensureTrailingSeparator(destinationRoot);

    if (!absolute.startsWith(normalizedDestination) && absolute !== destinationRoot) {
        throw new Error(`Archive entry escapes destination directory: ${entryName}`);
    }

    return { absolutePath: absolute };
}

function normalizeEntryName(entryName: string): string | undefined {
    const replaced = entryName.replace(/\\/g, "/");
    const trimmed = replaced.replace(/^\/+/, "");

    if (!trimmed) {
        return undefined;
    }

    const segments = trimmed.split("/");
    const filteredSegments: string[] = [];

    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            throw new Error(`Archive entry attempts to navigate outside destination: ${entryName}`);
        }

        filteredSegments.push(segment);
    }

    if (filteredSegments.length === 0) {
        return undefined;
    }

    return filteredSegments.join(path.sep);
}

function validateNativeEntryName(entryName: string): void {
    const replaced = entryName.replace(/\\/g, "/");

    if (!replaced) {
        return;
    }

    if (replaced.startsWith("/") || /^[A-Za-z]:/.test(replaced)) {
        throw new Error(`Archive entry uses absolute path: ${entryName}`);
    }

    const segments = replaced.split("/");

    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            throw new Error(`Archive entry attempts to navigate outside destination: ${entryName}`);
        }
    }
}

function ensureTrailingSeparator(directory: string): string {
    const normalized = path.resolve(directory);

    return normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`;
}

async function extractZipEntryData(buffer: Buffer, entry: ZipCentralDirectoryEntry): Promise<Buffer> {
    const localHeaderOffset = entry.localHeaderOffset;
    const signature = buffer.readUInt32LE(localHeaderOffset);

    if (signature !== 0x04034b50) {
        throw new Error(`Invalid ZIP local file header signature for ${entry.fileName}`);
    }

    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    const dataEnd = dataOffset + entry.compressedSize;

    if (dataEnd > buffer.length) {
        throw new Error(`ZIP entry data exceeds archive bounds: ${entry.fileName}`);
    }

    const compressedData = buffer.subarray(dataOffset, dataEnd);

    if (entry.compressionMethod === 0) {
        return Buffer.from(compressedData);
    }

    const inflated = await inflateRawAsync(compressedData);

    if (entry.uncompressedSize !== 0 && inflated.length !== entry.uncompressedSize) {
        throw new Error(`Unexpected uncompressed size for ${entry.fileName}.`);
    }

    return inflated;
}

function inflateRawAsync(data: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        inflateRawCallback(data, (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        });
    });
}

async function extractTarArchive(buffer: Buffer, destination: string): Promise<void> {
    const blockSize = 512;
    const destinationRoot = path.resolve(destination);
    let offset = 0;
    let pendingLongName: string | null = null;
    let pendingPaxAttributes: Record<string, string> | null = null;
    let globalPaxAttributes: Record<string, string> = {};

    while (offset + blockSize <= buffer.length) {
        const header = buffer.subarray(offset, offset + blockSize);

        if (isTarEndBlock(header)) {
            break;
        }

        const name = readTarString(header, 0, 100);
        const prefix = readTarString(header, 345, 155);
        const entryName = combineTarPath(prefix, name);
        const headerSize = readTarSize(header, 124, 12);
        const typeFlag = header[156] ?? 0;
        const dataOffset = offset + blockSize;
        let size = headerSize;

        if (!isTarMetadataType(typeFlag)) {
            const override = resolvePaxSizeOverride(pendingPaxAttributes, globalPaxAttributes);

            if (override !== null) {
                size = override;
            }
        }

        const paddedSize = alignToBlock(size, blockSize);
        const nextOffset = dataOffset + paddedSize;

        if (nextOffset > buffer.length) {
            throw new Error(`TAR entry exceeds archive bounds: ${entryName || name}`);
        }

        offset = nextOffset;

        if (!entryName) {
            continue;
        }

        if (isTarMetadataType(typeFlag)) {
            const sizeForMetadata = headerSize;

            if (sizeForMetadata > 0) {
                const data = buffer.subarray(dataOffset, dataOffset + sizeForMetadata);

                switch (typeFlag) {
                    case 76: { // 'L' - GNU long name
                        pendingLongName = readTarNullTerminatedString(data);
                        break;
                    }
                    case 120: { // 'x' - PAX extended header
                        pendingPaxAttributes = parsePaxHeaders(data);
                        break;
                    }
                    case 103: // 'g' - GNU global extended header
                    case 71: { // 'G' - Pax global header (some implementations)
                        const attributes = parsePaxHeaders(data);
                        globalPaxAttributes = {
                            ...globalPaxAttributes,
                            ...attributes,
                        };
                        break;
                    }
                    default: {
                        // Other metadata types do not affect path resolution for the next entry.
                        break;
                    }
                }
            }

            continue;
        }

        let effectiveEntryName = entryName;

        if (pendingLongName) {
            effectiveEntryName = pendingLongName;
        } else if (pendingPaxAttributes?.path) {
            effectiveEntryName = pendingPaxAttributes.path;
        } else if (globalPaxAttributes.path) {
            effectiveEntryName = globalPaxAttributes.path;
        }

        const entryPaxAttributes = pendingPaxAttributes;

        pendingLongName = null;
        pendingPaxAttributes = null;

        if (!effectiveEntryName) {
            continue;
        }

        validateNativeEntryName(effectiveEntryName);
        const resolved = resolveEntryPath(destinationRoot, effectiveEntryName);
        const headerMode = readTarMode(header);
        const mode = resolveTarEntryMode(headerMode, entryPaxAttributes, globalPaxAttributes);

        if (!resolved) {
            continue;
        }

        if (typeFlag === 53) {
            await mkdir(resolved.absolutePath, { recursive: true });
            if (mode !== undefined) {
                await chmod(resolved.absolutePath, mode);
            }
            continue;
        }

        if (typeFlag === 48 || typeFlag === 0) {
            const data = buffer.subarray(dataOffset, dataOffset + size);
            await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
            await writeFile(resolved.absolutePath, data);
            if (mode !== undefined) {
                await chmod(resolved.absolutePath, mode);
            }
            continue;
        }

        throw new Error(`Unsupported TAR entry type ${String.fromCharCode(typeFlag)} for ${entryName}`);
    }
}

function validateTarArchive(buffer: Buffer, destination: string): void {
    const blockSize = 512;
    const destinationRoot = path.resolve(destination);
    let offset = 0;
    let pendingLongName: string | null = null;
    let pendingPaxAttributes: Record<string, string> | null = null;
    let globalPaxAttributes: Record<string, string> = {};

    while (offset + blockSize <= buffer.length) {
        const header = buffer.subarray(offset, offset + blockSize);

        if (isTarEndBlock(header)) {
            break;
        }

        const name = readTarString(header, 0, 100);
        const prefix = readTarString(header, 345, 155);
        const entryName = combineTarPath(prefix, name);
        const headerSize = readTarSize(header, 124, 12);
        const typeFlag = header[156] ?? 0;
        const dataOffset = offset + blockSize;
        let size = headerSize;

        if (!isTarMetadataType(typeFlag)) {
            const override = resolvePaxSizeOverride(pendingPaxAttributes, globalPaxAttributes);

            if (override !== null) {
                size = override;
            }
        }

        const paddedSize = alignToBlock(size, blockSize);
        const nextOffset = dataOffset + paddedSize;

        if (nextOffset > buffer.length) {
            throw new Error(`TAR entry exceeds archive bounds: ${entryName || name}`);
        }

        offset = nextOffset;

        if (isTarMetadataType(typeFlag)) {
            const sizeForMetadata = headerSize;

            if (sizeForMetadata > 0) {
                const data = buffer.subarray(dataOffset, dataOffset + sizeForMetadata);

                switch (typeFlag) {
                    case 76: { // 'L' - GNU long name
                        pendingLongName = readTarNullTerminatedString(data);
                        break;
                    }
                    case 120: { // 'x' - PAX extended header
                        pendingPaxAttributes = parsePaxHeaders(data);
                        break;
                    }
                    case 103: // 'g' - GNU global extended header
                    case 71: { // 'G' - Pax global header (some implementations)
                        const attributes = parsePaxHeaders(data);
                        globalPaxAttributes = {
                            ...globalPaxAttributes,
                            ...attributes,
                        };
                        break;
                    }
                    default: {
                        // Other metadata types do not affect path resolution for the next entry.
                        break;
                    }
                }
            }

            continue;
        }

        let effectiveEntryName = entryName;

        if (pendingLongName) {
            effectiveEntryName = pendingLongName;
        } else if (pendingPaxAttributes?.path) {
            effectiveEntryName = pendingPaxAttributes.path;
        } else if (globalPaxAttributes.path) {
            effectiveEntryName = globalPaxAttributes.path;
        }

        pendingLongName = null;
        pendingPaxAttributes = null;

        if (!effectiveEntryName) {
            continue;
        }

        validateNativeEntryName(effectiveEntryName);
        const resolved = resolveEntryPath(destinationRoot, effectiveEntryName);

        if (!resolved) {
            continue;
        }

        if (typeFlag === 53 || typeFlag === 48 || typeFlag === 0) {
            continue;
        }

        throw new Error(`Unsupported TAR entry type ${String.fromCharCode(typeFlag)} for ${entryName}`);
    }
}

function isTarMetadataType(typeFlag: number): boolean {
    switch (typeFlag) {
        case 103: // 'g' - GNU global extended header
        case 120: // 'x' - PAX extended header
        case 71: // 'G' - Pax global header (some implementations)
        case 76: // 'L' - GNU long name
        case 75: // 'K' - GNU long link
        case 80: // 'P' - POSIX portability entry
        case 78: // 'N' - Old GNU sparse file metadata
        case 83: // 'S' - GNU sparse metadata
        case 86: // 'V' - Volume header
        case 88: // 'X' - POSIX extended attribute
            return true;
        default:
            return false;
    }
}

function isTarEndBlock(block: Buffer): boolean {
    return block.every((value) => value === 0);
}

function readTarString(block: Buffer, start: number, length: number): string {
    const raw = block.subarray(start, start + length);
    let end = raw.indexOf(0);

    if (end === -1) {
        end = raw.length;
    }

    return raw.subarray(0, end).toString("utf8");
}

function readTarNullTerminatedString(data: Buffer): string {
    const zeroIndex = data.indexOf(0);

    if (zeroIndex === -1) {
        return data.toString("utf8");
    }

    return data.subarray(0, zeroIndex).toString("utf8");
}

function parsePaxHeaders(data: Buffer): Record<string, string> {
    const result: Record<string, string> = {};
    let offset = 0;

    while (offset < data.length) {
        const spaceIndex = data.indexOf(0x20, offset);

        if (spaceIndex === -1) {
            break;
        }

        const lengthString = data.subarray(offset, spaceIndex).toString("utf8").trim();
        const recordLength = Number.parseInt(lengthString, 10);

        if (!Number.isFinite(recordLength) || recordLength <= 0) {
            break;
        }

        const recordEnd = offset + recordLength;

        if (recordEnd > data.length) {
            break;
        }

        const record = data.subarray(spaceIndex + 1, recordEnd);
        const recordString = record.toString("utf8");
        const equalsIndex = recordString.indexOf("=");

        if (equalsIndex !== -1) {
            const key = recordString.substring(0, equalsIndex);
            const value = recordString.substring(equalsIndex + 1).replace(/\n$/, "");
            result[key] = value;
        }

        offset = recordEnd;
    }

    return result;
}

function resolvePaxSizeOverride(
    pendingAttributes: Record<string, string> | null,
    globalAttributes: Record<string, string>,
): number | null {
    const sizeString = pendingAttributes?.size ?? globalAttributes.size;

    if (!sizeString) {
        return null;
    }

    const parsed = Number.parseInt(sizeString, 10);

    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

function combineTarPath(prefix: string, name: string): string {
    if (!prefix) {
        return name;
    }

    if (!name) {
        return prefix;
    }

    if (prefix.endsWith("/")) {
        return `${prefix}${name}`;
    }

    return `${prefix}/${name}`;
}

function readTarMode(block: Buffer): number | undefined {
    const raw = block.subarray(100, 108).toString("ascii");
    const trimmed = raw.replace(/\0.*$/, "").trim();

    if (!trimmed) {
        return undefined;
    }

    const parsed = Number.parseInt(trimmed, 8);

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return normalizeFileMode(parsed);
}

function resolveTarEntryMode(
    headerMode: number | undefined,
    entryAttributes: Record<string, string> | null,
    globalAttributes: Record<string, string>,
): number | undefined {
    const paxMode = parsePaxModeValue(entryAttributes?.mode ?? globalAttributes.mode);

    if (paxMode !== undefined) {
        return paxMode;
    }

    return normalizeFileMode(headerMode);
}

function parsePaxModeValue(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();

    if (!trimmed) {
        return undefined;
    }

    const base = /^[0-7]+$/.test(trimmed) ? 8 : 10;
    const parsed = Number.parseInt(trimmed, base);

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return normalizeFileMode(parsed);
}

function readTarSize(block: Buffer, start: number, length: number): number {
    const raw = block.subarray(start, start + length).toString("ascii");
    const trimmed = raw.replace(/\0.*$/, "").trim();

    if (!trimmed) {
        return 0;
    }

    return parseInt(trimmed, 8);
}

function alignToBlock(size: number, blockSize: number): number {
    if (size === 0) {
        return 0;
    }

    const remainder = size % blockSize;

    if (remainder === 0) {
        return size;
    }

    return size + (blockSize - remainder);
}

function gunzipAsync(buffer: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        gunzipCallback(buffer, (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        });
    });
}

async function attemptManualFallback(context: ManualExtractionPromptContext): Promise<string | undefined> {
    const prompt = manualPromptImplementation ?? defaultManualExtractionPrompt;
    const response = await prompt(context);

    if (!response) {
        return undefined;
    }

    const resolved = path.resolve(response);
    const stats = await stat(resolved);

    if (!stats.isDirectory()) {
        throw new Error("Manual extraction path must be a directory.");
    }

    return resolved;
}

async function defaultManualExtractionPrompt(
    context: ManualExtractionPromptContext,
): Promise<string | undefined> {
    try {
        const vscodeModule: typeof import("vscode") = await import("vscode");
        const selection = await vscodeModule.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select extracted folder",
            title: "Provide extracted archive contents",
            defaultUri: vscodeModule.Uri.file(context.destination),
        });

        if (!selection || selection.length === 0) {
            return undefined;
        }

        return selection[0]!.fsPath;
    } catch {
        return undefined;
    }
}

function wrapError(message: string, error: unknown): Error {
    if (error instanceof Error) {
        return new Error(`${message}: ${error.message}`, { cause: error });
    }

    return new Error(`${message}: ${String(error)}`);
}

async function ensureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
}

async function cleanupDirectory(directory: string): Promise<void> {
    await rm(directory, { recursive: true, force: true });
}

async function withTemporaryDirectory<T>(
    destination: string,
    action: (workingDirectory: string) => Promise<T>,
): Promise<T> {
    const prefix = path.join(destination, ".jaenvtix-extract-");
    const workingDirectory = await mkdtemp(prefix);

    try {
        return await action(workingDirectory);
    } finally {
        try {
            await cleanupDirectory(workingDirectory);
        } catch {
            // ignore cleanup failures
        }
    }
}

async function moveDirectoryContents(source: string, destination: string): Promise<void> {
    const entries = await readdir(source);

    for (const entry of entries) {
        const sourcePath = path.join(source, entry);
        const targetPath = path.join(destination, entry);

        await rm(targetPath, { recursive: true, force: true });
        await rename(sourcePath, targetPath);
    }
}

function createAggregateExtractionError(archivePath: string, errors: Error[]): Error {
    const messageLines = [`Failed to extract archive at ${archivePath}.`];

    if (errors.length > 0) {
        messageLines.push("Encountered the following errors:");

        for (const error of errors) {
            messageLines.push(`- ${error.message}`);
        }
    }

    const message = messageLines.join("\n");

    if (typeof AggregateError === "function") {
        return new AggregateError(errors, message);
    }

    const composite = new Error(message);
    (composite as { errors?: Error[] }).errors = errors;

    return composite;
}
