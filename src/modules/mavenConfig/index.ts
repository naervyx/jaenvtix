import { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ToolchainEntry {
    readonly vendor: string;
    readonly versions: readonly string[];
    readonly javaHome: string;
}

export interface SyncToolchainsOptions {
    readonly fileSystem?: Pick<typeof fsPromises, "mkdir" | "readFile" | "writeFile">;
    readonly toolchainsPath?: string;
}

export interface EnsureSettingsOptions {
    readonly fileSystem?: Pick<typeof fsPromises, "mkdir" | "readFile" | "writeFile">;
}

const DEFAULT_TOOLCHAINS_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n</toolchains>\n`;

const DEFAULT_SETTINGS_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>\n<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"\n          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">\n</settings>\n`;

export async function syncToolchains(
    toolchain: ToolchainEntry,
    options: SyncToolchainsOptions = {},
): Promise<void> {
    const fileSystem = options.fileSystem ?? fsPromises;
    const toolchainsPath = options.toolchainsPath ?? resolveDefaultToolchainsPath();
    const directory = path.dirname(toolchainsPath);

    await fileSystem.mkdir(directory, { recursive: true });

    const existingContent = await readFileOrDefault(fileSystem, toolchainsPath, DEFAULT_TOOLCHAINS_CONTENT);
    const updatedContent = mergeToolchain(existingContent, toolchain);

    if (existingContent === updatedContent) {
        return;
    }

    await fileSystem.writeFile(toolchainsPath, ensureTrailingNewline(updatedContent), "utf8");
}

export async function ensureSettings(targetPath?: string, options: EnsureSettingsOptions = {}): Promise<string> {
    const fileSystem = options.fileSystem ?? fsPromises;
    const settingsPath = targetPath ?? resolveDefaultSettingsPath();
    const directory = path.dirname(settingsPath);

    await fileSystem.mkdir(directory, { recursive: true });

    try {
        await fileSystem.readFile(settingsPath, "utf8");
    } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
        }

        await fileSystem.writeFile(settingsPath, DEFAULT_SETTINGS_CONTENT, "utf8");
    }

    return settingsPath;
}

function mergeToolchain(content: string, toolchain: ToolchainEntry): string {
    const versions = Array.from(new Set(toolchain.versions.map((value) => value.trim()).filter(Boolean)));
    if (versions.length === 0) {
        return content;
    }

    let merged = stripMatchingEntries(content, toolchain.vendor, versions);
    const toolchainsEndIndex = merged.lastIndexOf("</toolchains>");

    if (toolchainsEndIndex === -1) {
        merged = DEFAULT_TOOLCHAINS_CONTENT;
    }

    const insertionPoint = merged.lastIndexOf("</toolchains>");
    if (insertionPoint === -1) {
        return merged;
    }

    const before = merged.slice(0, insertionPoint).replace(/\s*$/g, "");
    const after = merged.slice(insertionPoint);
    const newEntries = versions
        .map((version) => renderToolchainBlock({
            vendor: toolchain.vendor,
            version,
            javaHome: toolchain.javaHome,
        }))
        .join("\n");

    const prefix = before.length > 0 ? `${before}\n` : "";
    const suffix = after.startsWith("\n") ? after : `\n${after}`;

    return `${prefix}${newEntries}${suffix}`;
}

function renderToolchainBlock(entry: { vendor: string; version: string; javaHome: string }): string {
    const vendor = escapeXml(entry.vendor);
    const version = escapeXml(entry.version);
    const javaHome = escapeXml(normalizePath(entry.javaHome));

    return [
        "  <toolchain>",
        "    <type>jdk</type>",
        "    <provides>",
        `      <version>${version}</version>`,
        `      <vendor>${vendor}</vendor>`,
        "    </provides>",
        "    <configuration>",
        `      <jdkHome>${javaHome}</jdkHome>`,
        "    </configuration>",
        "  </toolchain>",
    ].join("\n");
}

function stripMatchingEntries(content: string, vendor: string, versions: readonly string[]): string {
    const normalizedVendor = vendor.trim();
    if (!normalizedVendor) {
        return content;
    }

    const versionSet = new Set(versions.map((value) => value.trim()).filter(Boolean));
    if (versionSet.size === 0) {
        return content;
    }

    const toolchainPattern = /(^[ \t]*)<toolchain>[\s\S]*?<\/toolchain>/gim;
    let hasChanges = false;

    const updated = content.replace(toolchainPattern, (match) => {
        const vendorMatch = match.match(/<vendor>([^<]+)<\/vendor>/i);
        if (!vendorMatch) {
            return match;
        }

        const [, vendorGroup = ""] = vendorMatch;
        const vendorValue = vendorGroup.trim();
        if (vendorValue !== normalizedVendor) {
            return match;
        }

        const versionMatches = Array.from(match.matchAll(/<version>([^<]+)<\/version>/gi));
        if (versionMatches.length === 0) {
            return match;
        }

        const includesTarget = versionMatches.some((candidate) => {
            const [, versionGroup = ""] = candidate;

            return versionSet.has(versionGroup.trim());
        });
        if (!includesTarget) {
            return match;
        }

        hasChanges = true;
        return "";
    });

    return hasChanges ? collapseBlankLines(updated) : content;
}

function collapseBlankLines(content: string): string {
    return content.replace(/\n{3,}/g, "\n\n");
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/");
}

async function readFileOrDefault(
    fileSystem: Pick<typeof fsPromises, "readFile" | "writeFile">,
    target: string,
    defaultContent: string,
): Promise<string> {
    try {
        const buffer = await fileSystem.readFile(target, "utf8");
        return buffer.toString();
    } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
        }

        await fileSystem.writeFile(target, defaultContent, "utf8");
        return defaultContent;
    }
}

function resolveDefaultToolchainsPath(): string {
    return path.join(os.homedir(), ".m2", "toolchains.xml");
}

function resolveDefaultSettingsPath(): string {
    return path.join(os.homedir(), ".m2", "settings.xml");
}

function ensureTrailingNewline(content: string): string {
    return content.endsWith("\n") ? content : `${content}\n`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return Boolean(error) && typeof error === "object" && "code" in (error as Record<string, unknown>);
}
