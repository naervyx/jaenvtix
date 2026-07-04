#!/usr/bin/env node
/**
 * Upstream schema watch (P4.12).
 *
 * Fetches the package.json of every base extension Jaenvtix integrates with,
 * extracts the public surface Jaenvtix depends on (configuration property IDs
 * and command IDs), and compares it against the committed snapshot
 * (`scripts/upstream-schema-snapshot.json`).
 *
 * Usage:
 *   node scripts/check-upstream-schemas.mjs           # diff against snapshot; exit 1 on drift
 *   node scripts/check-upstream-schemas.mjs --update  # rewrite the snapshot from upstream
 *
 * Zero dependencies on purpose (global fetch, Node 18+): this script runs in
 * CI and on dev machines without an install step.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'upstream-schema-snapshot.json');

/** The 8 base extensions Jaenvtix cooperates with, tracked on their main branches. */
const UPSTREAM_EXTENSIONS = [
    {
        id: 'redhat.java',
        manifestUrl: 'https://raw.githubusercontent.com/redhat-developer/vscode-java/main/package.json',
    },
    {
        id: 'vscjava.vscode-java-debug',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/package.json',
    },
    {
        id: 'vscjava.vscode-java-test',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-java-test/main/package.json',
    },
    {
        id: 'vscjava.vscode-maven',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-maven/main/package.json',
    },
    {
        id: 'vscjava.vscode-java-dependency',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-java-dependency/main/package.json',
    },
    {
        id: 'vscjava.vscode-spring-initializr',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-spring-initializr/main/package.json',
    },
    {
        id: 'vscjava.vscode-spring-boot-dashboard',
        manifestUrl: 'https://raw.githubusercontent.com/microsoft/vscode-spring-boot-dashboard/main/package.json',
    },
    {
        id: 'vmware.vscode-spring-boot',
        manifestUrl: 'https://raw.githubusercontent.com/spring-projects/spring-tools/main/vscode-extensions/vscode-spring-boot/package.json',
    },
];

/**
 * Extracts configuration property IDs and command IDs from an extension
 * manifest. `contributes.configuration` may be a single section object or an
 * array of sections — both shapes exist across the tracked extensions.
 */
function extractSchema(manifest) {
    const settings = new Set();
    const configuration = manifest?.contributes?.configuration;
    const sections = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
    for (const section of sections) {
        for (const propertyId of Object.keys(section?.properties ?? {})) {
            settings.add(propertyId);
        }
    }

    const commands = new Set();
    for (const command of manifest?.contributes?.commands ?? []) {
        if (typeof command?.command === 'string') {
            commands.add(command.command);
        }
    }

    return {
        settings: [...settings].sort(),
        commands: [...commands].sort(),
    };
}

async function fetchCurrentSnapshot() {
    const snapshot = {};
    for (const extension of UPSTREAM_EXTENSIONS) {
        const response = await fetch(extension.manifestUrl);
        if (!response.ok) {
            throw new Error(`Fetching ${extension.manifestUrl} failed with HTTP ${response.status}`);
        }
        snapshot[extension.id] = extractSchema(await response.json());
    }
    return snapshot;
}

function diffLists(kind, extensionId, before, after, lines) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    for (const entry of after) {
        if (!beforeSet.has(entry)) {
            lines.push(`  + ${extensionId} ${kind}: ${entry}`);
        }
    }
    for (const entry of before) {
        if (!afterSet.has(entry)) {
            lines.push(`  - ${extensionId} ${kind}: ${entry}`);
        }
    }
}

function diffSnapshots(stored, current) {
    const lines = [];
    for (const extension of UPSTREAM_EXTENSIONS) {
        const before = stored[extension.id] ?? {settings: [], commands: []};
        const after = current[extension.id];
        diffLists('setting', extension.id, before.settings, after.settings, lines);
        diffLists('command', extension.id, before.commands, after.commands, lines);
    }
    return lines;
}

async function main() {
    const current = await fetchCurrentSnapshot();

    if (process.argv.includes('--update')) {
        writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 4)}\n`, 'utf-8');
        console.log(`Snapshot updated: ${SNAPSHOT_PATH}`);
        return;
    }

    let stored;
    try {
        stored = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
    } catch {
        console.error(`Snapshot missing or unreadable at ${SNAPSHOT_PATH}. Run with --update first.`);
        process.exitCode = 1;
        return;
    }

    const drift = diffSnapshots(stored, current);
    if (drift.length === 0) {
        console.log('Upstream schemas match the committed snapshot.');
        return;
    }

    console.log('Upstream schema drift detected:');
    for (const line of drift) {
        console.log(line);
    }
    console.log('\nReview the changes above (renamed/deprecated keys Jaenvtix writes are the risk),');
    console.log('then refresh with: node scripts/check-upstream-schemas.mjs --update');
    process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
