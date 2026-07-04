import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// Contract test (P4.13): every setting or command of a base extension that
// Jaenvtix references in source code must exist in the committed upstream
// schema snapshot (scripts/upstream-schema-snapshot.json, maintained by
// scripts/check-upstream-schemas.mjs). This catches typos and upstream
// renames at test time instead of in a user's settings.json — it caught its
// first real bug during development: a `java.import.maven.userSettings` key
// that a README suggested but the upstream manifest never declared.

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const SNAPSHOT_PATH = join(__dirname, '..', '..', 'scripts', 'upstream-schema-snapshot.json');

/** Prefixes owned by the tracked base extensions. `jaenvtix.*` is ours; `terminal.*` is VS Code core. */
const TRACKED_PREFIX = /^(?:java|maven|spring-boot|spring)\./;

/**
 * Literals that match the tracked prefixes but are NOT VS Code setting or
 * command IDs: binary file names and Maven pom property names.
 */
const NON_SETTING_LITERALS = new Set([
    'java.exe',
    'java.version',
    'maven.compiler.source',
    'maven.compiler.release',
]);

type SchemaSnapshot = Record<string, {settings: string[]; commands: string[]}>;

function collectTypeScriptFiles(root: string, files: string[] = []): string[] {
    for (const entry of readdirSync(root, {withFileTypes: true})) {
        const entryPath = join(root, entry.name);
        if (entry.isDirectory()) {
            collectTypeScriptFiles(entryPath, files);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(entryPath);
        }
    }
    return files;
}

/** Extracts single-quoted string literals that look like base-extension IDs. */
function collectTrackedLiterals(): Map<string, string[]> {
    const literalToFiles = new Map<string, string[]>();

    for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
        const source = readFileSync(filePath, 'utf-8');
        for (const match of source.matchAll(/'([^'\\]+)'/g)) {
            const literal = match[1] ?? '';
            if (!TRACKED_PREFIX.test(literal) || NON_SETTING_LITERALS.has(literal)) {
                continue;
            }
            const files = literalToFiles.get(literal) ?? [];
            if (!files.includes(filePath)) {
                files.push(filePath);
            }
            literalToFiles.set(literal, files);
        }
    }

    return literalToFiles;
}

describe('upstream settings contract', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SchemaSnapshot;

    const knownIds = new Set<string>();
    for (const schema of Object.values(snapshot)) {
        for (const setting of schema.settings) {
            knownIds.add(setting);
        }
        for (const command of schema.commands) {
            knownIds.add(command);
        }
    }

    function isKnown(literal: string): boolean {
        if (knownIds.has(literal)) {
            return true;
        }
        // Section prefixes are valid too: getConfiguration('java.configuration')
        // is correct as long as some known setting lives under that section.
        const asPrefix = `${literal}.`;
        for (const id of knownIds) {
            if (id.startsWith(asPrefix)) {
                return true;
            }
        }
        return false;
    }

    it('snapshot covers all 8 tracked extensions with non-empty schemas', () => {
        const extensionIds = Object.keys(snapshot);
        assert.equal(extensionIds.length, 8);
        for (const [extensionId, schema] of Object.entries(snapshot)) {
            assert.ok(
                schema.settings.length + schema.commands.length > 0,
                `snapshot for ${extensionId} is empty — re-run scripts/check-upstream-schemas.mjs --update`,
            );
        }
        // Spot checks that the extraction understood both manifest shapes.
        assert.ok(snapshot['redhat.java']?.settings.includes('java.jdt.ls.java.home'));
        assert.ok(snapshot['vscjava.vscode-maven']?.settings.includes('maven.terminal.favorites'));
    });

    it('every base-extension key referenced in src/ exists upstream', () => {
        const literals = collectTrackedLiterals();

        // Guard against the scanner silently matching nothing (which would
        // make this test pass vacuously after a refactor).
        assert.ok(literals.size >= 10, `scanner found only ${literals.size} tracked literals`);

        const unknown: string[] = [];
        for (const [literal, files] of literals) {
            if (!isKnown(literal)) {
                unknown.push(`${literal} (referenced in ${files.join(', ')})`);
            }
        }

        assert.deepEqual(
            unknown,
            [],
            'Keys referenced in src/ but absent from the upstream snapshot — either a typo, '
            + 'an upstream rename, or the snapshot needs a refresh via '
            + 'node scripts/check-upstream-schemas.mjs --update',
        );
    });
});
