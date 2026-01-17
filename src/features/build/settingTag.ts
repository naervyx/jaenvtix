import {dirname} from 'node:path';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';

interface VsCodeSettings {
    "java.jdt.ls.java.home"?: string;
    "java.jdt.ls.lombokSupport.enabled"?: boolean;
    "maven.executable.preferMavenWrapper"?: boolean;
    "maven.executable.path"?: string;
    "java.compile.nullAnalysis.mode"?: string;
    "java.configuration.updateBuildConfiguration"?: string;
    "java.configuration.maven.userSettings"?: string;
    [key: string]: unknown;
}

interface JavaMavenPaths {
    javaHomePath: string;
    mavenBinPath: string;
    userSettingsPath: string;
}

interface UpdateResult {
    updated: boolean;
    addedKeys: string[];
}

/**
 * Reads a JSON settings file, validates it, and adds missing tags.
 * @param settingsPath - Path to the settings.json file.
 * @param paths - Paths for Java, Maven, and user settings.
 * @returns Result indicating whether an update occurred and which keys were added.
 */
export function updateVsCodeSettings(
    settingsPath: string,
    paths: JavaMavenPaths
): UpdateResult {
    const result: UpdateResult = {
        updated: false,
        addedKeys: []
    };

    // Read the existing JSON file or create an empty object.
    let data: VsCodeSettings = {};
    
    if (existsSync(settingsPath)) {
        const fileContent = readFileSync(settingsPath, 'utf-8');
        try {
            data = JSON.parse(fileContent) as VsCodeSettings;
        } catch {
            console.error('Failed to parse the JSON file; creating a new object.');
            data = {};
        }
    }

    // Define required settings.
    const requiredSettings: Record<string, unknown> = {
        "java.jdt.ls.java.home": paths.javaHomePath,
        "java.jdt.ls.lombokSupport.enabled": true,
        "maven.executable.preferMavenWrapper": true,
        "maven.executable.path": paths.mavenBinPath,
        "java.compile.nullAnalysis.mode": "automatic",
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.configuration.maven.userSettings": paths.userSettingsPath
    };

    // Check each setting and add it if missing.
    for (const [key, value] of Object.entries(requiredSettings)) {
        if (!(key in data)) {
            data[key] = value;
            result.addedKeys.push(key);
            result.updated = true;
        }
    }

    // Save the file if changes were made.
    if (result.updated) {
        const dirPath = dirname(settingsPath);
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
        }

        writeFileSync(settingsPath, JSON.stringify(data, null, 4), 'utf-8');
    }

    return result;
}
