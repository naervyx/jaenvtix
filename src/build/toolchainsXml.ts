export interface ToolchainEntry {
    vendor: string;
    version: string;
    jdkHome: string;
}

export interface ToolchainsMergeResult {
    xml: string;
    updated: boolean;
}

const EMPTY_TOOLCHAINS_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<toolchains>',
    '</toolchains>',
    '',
].join('\n');

/**
 * Extracts the JDK vendor name from the contents of a JDK `release` file.
 *
 * The `release` file ships next to the JDK binaries (e.g. `<jdk-home>/release`)
 * and exposes shell-style `KEY="VALUE"` entries. We only need the implementor —
 * the first word, lowercased — which is enough for Maven's `<vendor>` field
 * (Maven treats it as opaque metadata, but the convention is `amazon`,
 * `oracle`, `eclipse`, `azul`, etc.).
 *
 * Returns `'unknown'` when the file is malformed or missing the implementor.
 */
export function parseJdkVendor(releaseFileContent: string): string {
    const match = /^IMPLEMENTOR="([^"]*)"/m.exec(releaseFileContent);
    if (!match || !match[1]) {
        return 'unknown';
    }

    const trimmed = match[1].trim();
    if (!trimmed) {
        return 'unknown';
    }

    const firstWord = trimmed.split(/\s+/)[0] ?? '';
    if (!firstWord) {
        return 'unknown';
    }

    // Strip trailing punctuation like "Amazon.com" → "amazon"
    const sanitized = firstWord.replace(/[^A-Za-z0-9-]/g, '').toLowerCase();
    return sanitized || 'unknown';
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildToolchainBlock(entry: ToolchainEntry): string {
    return [
        '    <toolchain>',
        '        <type>jdk</type>',
        '        <provides>',
        `            <version>${escapeXml(entry.version)}</version>`,
        `            <vendor>${escapeXml(entry.vendor)}</vendor>`,
        '        </provides>',
        '        <configuration>',
        `            <jdkHome>${escapeXml(entry.jdkHome)}</jdkHome>`,
        '        </configuration>',
        '    </toolchain>',
    ].join('\n');
}

/**
 * Determines whether the given XML already references a `<toolchain>` for the
 * supplied `jdkHome`. We use a substring check on the escaped path because
 * `toolchains.xml` schema mandates a `<jdkHome>` per toolchain — there is no
 * other place a path like that would legitimately appear.
 */
function xmlContainsJdkHome(xml: string, jdkHome: string): boolean {
    const needle = `<jdkHome>${escapeXml(jdkHome)}</jdkHome>`;
    return xml.includes(needle);
}

/**
 * Merges Jaenvtix-managed JDKs into an existing `~/.m2/toolchains.xml` content
 * without touching toolchains the user (or another tool) authored.
 *
 * Business rules:
 * - When `existingXml` is empty/whitespace, the function bootstraps a minimal
 *   `<toolchains>` document.
 * - For each candidate, the function inserts a new `<toolchain>` block ONLY
 *   when no existing toolchain already references the same `<jdkHome>`. Path
 *   match (not `vendor`/`version`) is the de-duplication key — a single JDK
 *   should produce a single toolchain entry.
 * - Existing toolchains are preserved verbatim — Jaenvtix never edits or
 *   removes pre-existing entries.
 * - Insertion happens immediately before the closing `</toolchains>` tag, so
 *   ordering of pre-existing entries is preserved.
 */
export function mergeToolchainsXml(
    existingXml: string,
    candidates: readonly ToolchainEntry[]
): ToolchainsMergeResult {
    const baseXml = existingXml.trim() ? existingXml : EMPTY_TOOLCHAINS_XML;

    const closingIndex = baseXml.lastIndexOf('</toolchains>');
    if (closingIndex < 0) {
        // Existing file is malformed or missing the closing tag — start fresh
        // rather than try to surgery something we don't understand. This is
        // the safest behaviour: a corrupt toolchains.xml shouldn't block
        // configuration and the user can always inspect git history.
        return mergeToolchainsXml(EMPTY_TOOLCHAINS_XML, candidates);
    }

    const newBlocks: string[] = [];
    for (const candidate of candidates) {
        if (xmlContainsJdkHome(baseXml, candidate.jdkHome)) {
            continue;
        }
        if (newBlocks.some((block) => block.includes(`<jdkHome>${escapeXml(candidate.jdkHome)}</jdkHome>`))) {
            continue;
        }
        newBlocks.push(buildToolchainBlock(candidate));
    }

    if (newBlocks.length === 0) {
        return {xml: baseXml, updated: false};
    }

    const before = baseXml.slice(0, closingIndex);
    const after = baseXml.slice(closingIndex);
    const trimmedBefore = before.replace(/\s*$/, '');
    const merged = `${trimmedBefore}\n${newBlocks.join('\n')}\n${after}`;

    return {xml: merged, updated: true};
}
