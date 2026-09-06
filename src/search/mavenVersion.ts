import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {scanXml} from './xmlScanner';

/** Accepts `3.9`, `3.9.5`, `4.0.0`: plain dotted numeric versions only. */
const MAVEN_VERSION_PATTERN = /^\d+(\.\d+)+$/;

/**
 * Extracts the Maven version a `pom.xml` pins, if any.
 *
 * Recognized configuration patterns (in priority order):
 * - `<prerequisites><maven>X.Y.Z</maven></prerequisites>`: Maven's own
 *   minimum-version contract; the strongest signal of intent.
 * - `<properties><maven.version>X.Y.Z</maven.version></properties>`: common
 *   team convention.
 *
 * Business rules:
 * - `<prerequisites>` wins when both are present.
 * - Values that are not plain dotted numeric versions (e.g. property
 *   placeholders like `${maven.min}`) are ignored.
 * - Returns `null` when the pom pins nothing.
 */
export function parseMavenVersionFromXml(xml: string): string | null {
    const tagStack: string[] = [];
    let prerequisitesVersion: string | null = null;
    let propertyVersion: string | null = null;

    scanXml(xml, {
        onOpenTag(tagName) {
            tagStack.push(tagName);
        },
        onCloseTag(tagName) {
            const openIndex = tagStack.lastIndexOf(tagName);
            if (openIndex >= 0) {
                tagStack.length = openIndex;
            }
        },
        onText(text) {
            const value = text.trim();
            if (!value || !MAVEN_VERSION_PATTERN.test(value)) {
                return;
            }

            const tagName = tagStack[tagStack.length - 1];
            const parent = tagStack[tagStack.length - 2];
            const grandParent = tagStack[tagStack.length - 3];

            if (tagName === 'maven' && parent === 'prerequisites' && grandParent === 'project' && !prerequisitesVersion) {
                prerequisitesVersion = value;
            } else if (tagName === 'maven.version' && parent === 'properties' && grandParent === 'project' && !propertyVersion) {
                propertyVersion = value;
            }
        },
        isDone: () => prerequisitesVersion !== null,
    });

    return prerequisitesVersion ?? propertyVersion;
}

/**
 * Reads `pom.xml` from `pomPath` and returns the Maven version it pins,
 * or `null` when the file cannot be read or nothing is pinned.
 */
export function parseMavenVersionFromPom(pomPath: string): string | null {
    try {
        const pomXml = readFileSync(join(pomPath, 'pom.xml'), 'utf-8');
        return parseMavenVersionFromXml(pomXml);
    } catch {
        return null;
    }
}
