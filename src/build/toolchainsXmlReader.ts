import {existsSync, readFileSync} from 'node:fs';

import {scanXml} from '../search/xmlScanner';
import {buildDefaultM2ToolchainsPath} from './directory';
import {log} from '../util/logger';
import {Messages} from '../util/message';

/**
 * One `<toolchain type="jdk">` entry discovered in the user's
 * `~/.m2/toolchains.xml`. Unlike the writer's `ToolchainEntry`, version and
 * vendor are optional — hand-authored files often carry only `<jdkHome>`.
 */
export interface DiscoveredToolchainJdk {
    jdkHome: string;
    version?: string;
    vendor?: string;
}

/**
 * Parses the `<toolchain>` blocks of a Maven `toolchains.xml` document.
 *
 * Business rules:
 * - Only toolchains with `<type>jdk</type>` qualify; other types (e.g.
 *   `maven`) are user configuration for other plugins and are ignored.
 * - A toolchain without `<jdkHome>` is skipped — there is nothing to detect.
 * - Tolerant of malformed XML: incomplete blocks simply produce no entries.
 */
export function parseToolchainsXml(xml: string): DiscoveredToolchainJdk[] {
    const entries: DiscoveredToolchainJdk[] = [];
    const tagStack: string[] = [];
    let current: {type?: string; jdkHome?: string; version?: string; vendor?: string} | undefined;

    scanXml(xml, {
        onOpenTag(tagName) {
            tagStack.push(tagName);
            if (tagName === 'toolchain') {
                current = {};
            }
        },
        onCloseTag(tagName) {
            const openIndex = tagStack.lastIndexOf(tagName);
            if (openIndex >= 0) {
                tagStack.length = openIndex;
            }

            if (tagName === 'toolchain' && current) {
                if (current.type === 'jdk' && current.jdkHome) {
                    entries.push({
                        jdkHome: current.jdkHome,
                        version: current.version,
                        vendor: current.vendor,
                    });
                }
                current = undefined;
            }
        },
        onText(text) {
            if (!current) {
                return;
            }

            const value = text.trim();
            if (!value) {
                return;
            }

            const tagName = tagStack[tagStack.length - 1];
            const parent = tagStack[tagStack.length - 2];

            if (tagName === 'type' && parent === 'toolchain') {
                current.type = value;
            } else if (tagName === 'jdkHome' && parent === 'configuration') {
                current.jdkHome = value;
            } else if (tagName === 'version' && parent === 'provides') {
                current.version = value;
            } else if (tagName === 'vendor' && parent === 'provides') {
                current.vendor = value;
            }
        },
    });

    return entries;
}

/**
 * Reads the user's `~/.m2/toolchains.xml` (or `toolchainsPath` when given)
 * and returns its JDK toolchains.
 *
 * Business rules:
 * - A missing file is the normal case for most users → silent empty result.
 * - A file that cannot be read or parsed logs a warning and yields an empty
 *   result; discovery must never block the configuration pipeline.
 */
export function readToolchainsXml(
    toolchainsPath: string = buildDefaultM2ToolchainsPath(),
): DiscoveredToolchainJdk[] {
    if (!existsSync(toolchainsPath)) {
        return [];
    }

    try {
        return parseToolchainsXml(readFileSync(toolchainsPath, 'utf-8'));
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(Messages.Log.TOOLCHAINS_READ_FAILED(detail));
        return [];
    }
}
