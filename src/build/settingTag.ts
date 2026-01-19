import {dirname} from 'node:path';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {Messages} from '../util/message';

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
    updatedKeys: string[];
}

export function updateVsCodeSettings(
    settingsPath: string,
    paths: JavaMavenPaths
): UpdateResult {
    const result: UpdateResult = {
        updated: false,
        updatedKeys: []
    };

    let data: VsCodeSettings = {};
    
    if (existsSync(settingsPath)) {
        const fileContent = readFileSync(settingsPath, 'utf-8');
        try {
            data = JSON.parse(fileContent) as VsCodeSettings;
        } catch {
            console.error(Messages.Error.SETTINGS_PARSE_FAILED);
            data = {};
        }
    }

    const requiredSettings: Record<string, unknown> = {
        "java.jdt.ls.java.home": paths.javaHomePath,
        "java.jdt.ls.lombokSupport.enabled": true,
        "maven.executable.preferMavenWrapper": true,
        "maven.executable.path": paths.mavenBinPath,
        "java.compile.nullAnalysis.mode": "automatic",
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.configuration.maven.userSettings": paths.userSettingsPath
    };

    for (const [key, value] of Object.entries(requiredSettings)) {
        if (!Object.is(data[key], value)) {
            data[key] = value;
            result.updatedKeys.push(key);
            result.updated = true;
        }
    }

    if (result.updated) {
        const dirPath = dirname(settingsPath);
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
        }

        writeFileSync(settingsPath, JSON.stringify(data, null, 4), 'utf-8');
    }

    return result;
}
