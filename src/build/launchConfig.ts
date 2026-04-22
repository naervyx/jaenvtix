import {dirname} from 'node:path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {Messages} from '../util/message';

interface LaunchConfiguration {
    type: string;
    request: string;
    name: string;
    mainClass?: string;
    projectName?: string;
    [key: string]: unknown;
}

interface VsCodeLaunch {
    version?: string;
    configurations?: LaunchConfiguration[];
    [key: string]: unknown;
}

interface UpdateResult {
    updated: boolean;
    updatedNames: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfigurations(configurations: unknown): LaunchConfiguration[] {
    if (!Array.isArray(configurations)) {
        return [];
    }

    return configurations.filter((entry) => isRecord(entry)) as LaunchConfiguration[];
}

export function updateVsCodeLaunchConfig(
    launchPath: string,
    desiredConfigs: LaunchConfiguration[]
): UpdateResult {
    const result: UpdateResult = {
        updated: false,
        updatedNames: [],
    };

    let data: VsCodeLaunch = {};

    if (existsSync(launchPath)) {
        const fileContent = readFileSync(launchPath, 'utf-8');
        try {
            data = JSON.parse(fileContent) as VsCodeLaunch;
        } catch {
            console.error(Messages.Error.LAUNCH_PARSE_FAILED);
            data = {};
        }
    }

    if (data.version !== '0.2.0') {
        data.version = '0.2.0';
        result.updated = true;
    }

    const configurations = normalizeConfigurations(data.configurations);

    for (const desired of desiredConfigs) {
        const index = configurations.findIndex((entry) => entry.name === desired.name);
        if (index >= 0) {
            const existing = configurations[index];
            const merged = { ...existing, ...desired };
            const changed = Object.entries(desired).some(([key, value]) => !Object.is(existing[key], value));
            if (changed) {
                configurations[index] = merged;
                result.updated = true;
                result.updatedNames.push(desired.name);
            }
            continue;
        }

        configurations.push(desired);
        result.updated = true;
        result.updatedNames.push(desired.name);
    }

    if (result.updated) {
        data.configurations = configurations;
        const dirPath = dirname(launchPath);
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
        }

        writeFileSync(launchPath, JSON.stringify(data, null, 4), 'utf-8');
    }

    return result;
}
