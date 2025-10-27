import { promises as fsPromises } from "node:fs";
import * as path from "node:path";

import { applyEdits, modify } from "jsonc-parser";

type FileSystem = Pick<typeof fsPromises, "mkdir" | "readFile" | "writeFile">;

const formattingOptions = {
    insertSpaces: true,
    tabSize: 4,
    eol: "\n",
} as const;

export interface ToolchainInfo {
    readonly javaHome: string;
    readonly mavenWrapper?: string;
}

export interface UpdateWorkspaceSettingsOptions {
    readonly fileSystem?: FileSystem;
}

export async function updateWorkspaceSettings(
    projectPath: string,
    toolchainInfo: ToolchainInfo,
    options: UpdateWorkspaceSettingsOptions = {},
): Promise<void> {
    const fileSystem = options.fileSystem ?? fsPromises;
    const vscodeDirectory = path.join(projectPath, ".vscode");
    const settingsPath = path.join(vscodeDirectory, "settings.json");

    await fileSystem.mkdir(vscodeDirectory, { recursive: true });

    let currentContent = await readSettingsFile(fileSystem, settingsPath);
    let updatedContent = currentContent;
    let dirty = false;

    for (const [key, value] of Object.entries(resolveManagedSettings(toolchainInfo))) {
        const edits = modify(updatedContent, [key], value, { formattingOptions });
        if (edits.length === 0) {
            continue;
        }

        updatedContent = applyEdits(updatedContent, edits);
        dirty = true;
    }

    if (!dirty) {
        return;
    }

    if (!updatedContent.endsWith("\n")) {
        updatedContent += "\n";
    }

    await fileSystem.writeFile(settingsPath, updatedContent, "utf8");
}

async function readSettingsFile(fileSystem: FileSystem, target: string): Promise<string> {
    try {
        return await fileSystem.readFile(target, "utf8");
    } catch (error: unknown) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return "{}\n";
        }

        throw error;
    }
}

function resolveManagedSettings(toolchainInfo: ToolchainInfo): Record<string, unknown> {
    const settings: Record<string, unknown> = {
        "java.jdt.ls.java.home": toolchainInfo.javaHome,
        "maven.terminal.useJavaHome": true,
    };

    if (toolchainInfo.mavenWrapper) {
        settings["maven.executable.path"] = toolchainInfo.mavenWrapper;
    }

    return settings;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return Boolean(error) && typeof error === "object" && "code" in (error as NodeJS.ErrnoException);
}
