import {dirname, join} from 'node:path';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {Messages} from '../util/message';
import type {PlatformType} from '../core/system';

type TerminalEnv = Record<string, string>;

interface VsCodeSettings {
    "java.jdt.ls.java.home"?: string;
    "java.jdt.ls.lombokSupport.enabled"?: boolean;
    "maven.executable.preferMavenWrapper"?: boolean;
    "maven.executable.path"?: string;
    "java.compile.nullAnalysis.mode"?: string;
    "java.configuration.updateBuildConfiguration"?: string;
    "java.configuration.maven.userSettings"?: string;
    "java.configuration.runtimes"?: JavaRuntime[];
    "terminal.integrated.env.windows"?: TerminalEnv;
    "terminal.integrated.env.linux"?: TerminalEnv;
    "terminal.integrated.env.osx"?: TerminalEnv;
    [key: string]: unknown;
}

interface JavaMavenPaths {
    javaHomePath?: string;
    runtimes?: JavaRuntime[];
    terminalJavaHome: string;
    mavenHomePath: string;
    mavenBinPath: string;
    mavenExecutablePath: string;
    userSettingsPath: string;
    platform: PlatformType;
}

interface JavaRuntime {
    name: string;
    path: string;
    default?: boolean;
}

interface UpdateResult {
    updated: boolean;
    updatedKeys: string[];
}

function isRecord(value: unknown): value is Record<string, string> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveTerminalEnvKey(platform: PlatformType): keyof VsCodeSettings {
    if (platform === 'windows') {
        return 'terminal.integrated.env.windows';
    }

    if (platform === 'darwin') {
        return 'terminal.integrated.env.osx';
    }

    return 'terminal.integrated.env.linux';
}

function getPathVariableName(platform: PlatformType, existingEnv?: TerminalEnv): string {
    if (platform !== 'windows') {
        return 'PATH';
    }

    if (existingEnv && 'PATH' in existingEnv) {
        return 'PATH';
    }

    return 'Path';
}

function buildTerminalEnvUpdates(paths: JavaMavenPaths, existingEnv?: TerminalEnv): TerminalEnv {
    const javaBinPath = join(paths.terminalJavaHome, 'bin');
    const pathKey = getPathVariableName(paths.platform, existingEnv);
    const pathDelimiter = paths.platform === 'windows' ? ';' : ':';
    const envPathRef = pathKey === 'PATH' ? '${env:PATH}' : '${env:Path}';
    const combinedPath = `${javaBinPath}${pathDelimiter}${paths.mavenBinPath}${pathDelimiter}${envPathRef}`;

    return {
        JAVA_HOME: paths.terminalJavaHome,
        MAVEN_HOME: paths.mavenHomePath,
        M2_HOME: paths.mavenHomePath,
        [pathKey]: combinedPath,
    };
}

function mergeTerminalEnv(existing: unknown, updates: TerminalEnv): { merged: TerminalEnv; updated: boolean } {
    const existingEnv = isRecord(existing) ? existing as TerminalEnv : {};
    const merged: TerminalEnv = { ...existingEnv };
    let updated = !isRecord(existing);

    for (const [key, value] of Object.entries(updates)) {
        if (merged[key] !== value) {
            merged[key] = value;
            updated = true;
        }
    }

    return { merged, updated };
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
        "maven.executable.preferMavenWrapper": false,
        "maven.executable.path": paths.mavenExecutablePath,
        "java.compile.nullAnalysis.mode": "automatic",
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.configuration.maven.userSettings": paths.userSettingsPath,
    };

    for (const [key, value] of Object.entries(requiredSettings)) {
        if (typeof value === 'undefined') {
            if (key in data) {
                delete data[key];
                result.updatedKeys.push(key);
                result.updated = true;
            }
            continue;
        }

        if (!Object.is(data[key], value)) {
            data[key] = value;
            result.updatedKeys.push(key);
            result.updated = true;
        }
    }

    const runtimesKey = 'java.configuration.runtimes';
    if (!paths.runtimes || paths.runtimes.length === 0) {
        if (runtimesKey in data) {
            delete data[runtimesKey];
            result.updatedKeys.push(runtimesKey);
            result.updated = true;
        }
    } else {
        const existingRuntimes = data[runtimesKey];
        const isSameRuntime =
            Array.isArray(existingRuntimes) &&
            existingRuntimes.length === paths.runtimes.length &&
            existingRuntimes.every((entry, index) => {
                const runtimeEntry = entry as Partial<JavaRuntime>;
                const nextEntry = paths.runtimes?.[index];
                return Boolean(nextEntry) &&
                    runtimeEntry.name === nextEntry?.name &&
                    runtimeEntry.path === nextEntry?.path &&
                    Boolean(runtimeEntry.default) === Boolean(nextEntry?.default);
            });

        if (!isSameRuntime) {
            data[runtimesKey] = paths.runtimes;
            result.updatedKeys.push(runtimesKey);
            result.updated = true;
        }
    }

    const terminalEnvKey = resolveTerminalEnvKey(paths.platform);
    const existingTerminalEnv = isRecord(data[terminalEnvKey]) ? data[terminalEnvKey] as TerminalEnv : undefined;
    const terminalEnvUpdates = buildTerminalEnvUpdates(paths, existingTerminalEnv);
    const { merged: mergedTerminalEnv, updated: terminalEnvUpdated } = mergeTerminalEnv(
        data[terminalEnvKey],
        terminalEnvUpdates
    );

    if (terminalEnvUpdated) {
        data[terminalEnvKey] = mergedTerminalEnv;
        result.updatedKeys.push(String(terminalEnvKey));
        result.updated = true;
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
