/**
 * Java versions the Red Hat Language Server (redhat.java) declares support
 * for, discovered at runtime from the extension's own `package.json`. When
 * Red Hat ships support for a new Java release, Jaenvtix recognizes it
 * without requiring a new Jaenvtix release.
 */
export interface SupportedJavaVersions {
    /** Raw enum names, e.g. `['JavaSE-1.8', 'JavaSE-11', ..., 'JavaSE-25']`. */
    names: string[];
    /** Parsed major versions, ascending, e.g. `[8, 11, 17, 21, 25]`. */
    majors: number[];
    /** Majors that are LTS releases, ascending. */
    ltsList: number[];
    latestLts: number;
    latestAvailable: number;
}

/**
 * Mirrors the versions Jaenvtix 0.0.6 supported statically (including
 * Oracle-hosted 21/25). Used whenever redhat.java is absent or its
 * configuration schema changes shape.
 */
export const FALLBACK_SUPPORTED_JAVA_VERSIONS: SupportedJavaVersions = {
    names: ['JavaSE-1.8', 'JavaSE-11', 'JavaSE-17', 'JavaSE-21', 'JavaSE-25'],
    majors: [8, 11, 17, 21, 25],
    ltsList: [8, 11, 17, 21, 25],
    latestLts: 25,
    latestAvailable: 25,
};

/**
 * Returns `true` for Java LTS releases: 8, 11, and from 17 onward every
 * 4th release (17, 21, 25, 29, ...) per the current OpenJDK cadence.
 */
export function isLtsVersion(major: number): boolean {
    return major === 8 || major === 11 || (major >= 17 && (major - 17) % 4 === 0);
}

/** Parses `'J2SE-1.5'` → 5, `'JavaSE-1.8'` → 8, `'JavaSE-21'` → 21. */
function parseJavaSeMajor(name: string): number | null {
    const match = /^(?:J2|Java)SE-(?:1\.)?(\d+)$/.exec(name);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Builds a `SupportedJavaVersions` from the raw `name.enum` array found in
 * redhat.java's configuration schema. Returns `null` when the input is not a
 * usable enum (caller falls back to the static list).
 */
export function parseSupportedJavaVersions(enumNames: unknown): SupportedJavaVersions | null {
    if (!Array.isArray(enumNames) || enumNames.length === 0) {
        return null;
    }

    const names = enumNames.filter((name): name is string => typeof name === 'string');
    const majors = [...new Set(
        names
            .map(parseJavaSeMajor)
            .filter((major): major is number => major !== null),
    )].sort((a, b) => a - b);

    if (majors.length === 0) {
        return null;
    }

    const ltsList = majors.filter(isLtsVersion);

    return {
        names,
        majors,
        ltsList,
        latestLts: ltsList[ltsList.length - 1] ?? FALLBACK_SUPPORTED_JAVA_VERSIONS.latestLts,
        latestAvailable: majors[majors.length - 1] ?? FALLBACK_SUPPORTED_JAVA_VERSIONS.latestAvailable,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPath(value: unknown, ...keys: string[]): unknown {
    let current = value;
    for (const key of keys) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

/**
 * Reads the Java versions supported by the Red Hat Language Server.
 *
 * Business rules:
 * - `readRedhatPackageJson` is injected by the orchestrator (it queries
 *   `vscode.extensions.getExtension('redhat.java')`); this module never
 *   imports `vscode` so it stays loadable under plain Node in unit tests.
 * - Any failure — extension absent, schema moved, enum empty — falls back to
 *   the static list that mirrors Jaenvtix 0.0.6 behaviour. The fallback makes
 *   this a silent improvement with no opt-out setting.
 */
export function readSupportedJavaVersions(
    readRedhatPackageJson?: () => unknown,
): SupportedJavaVersions {
    if (!readRedhatPackageJson) {
        return FALLBACK_SUPPORTED_JAVA_VERSIONS;
    }

    try {
        const enumNames = getPath(
            readRedhatPackageJson(),
            'contributes', 'configuration', 'properties',
            'java.configuration.runtimes', 'items', 'properties', 'name', 'enum',
        );
        return parseSupportedJavaVersions(enumNames) ?? FALLBACK_SUPPORTED_JAVA_VERSIONS;
    } catch {
        return FALLBACK_SUPPORTED_JAVA_VERSIONS;
    }
}
