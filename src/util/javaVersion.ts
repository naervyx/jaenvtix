/**
 * Minimum Java version required to run the Java Language Server (jdt.ls).
 * Projects requiring Java < 21 still use their own JDK via the runtimes array,
 * but the tooling JDK that runs jdt.ls must be at least this version.
 */
export const TOOLING_JAVA_MIN_VERSION = 21;

/**
 * Parses a Java major version string (e.g. `'17'`) to its numeric value.
 * Unparseable strings yield `0` so callers can treat them as "no version".
 */
export function parseJavaVersionNumber(version: string): number {
    const parsed = Number.parseInt(version, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Returns `true` if the given Java major version string is at least `minimum`.
 * Unparseable version strings are treated as version 0 (always below minimum).
 */
export function isJavaVersionAtLeast(version: string, minimum: number): boolean {
    return parseJavaVersionNumber(version) >= minimum;
}

/**
 * Converts a Java major version string to the `name` value expected by
 * `java.configuration.runtimes` in VS Code settings.
 *
 * Business rules:
 * - Java 8 and older use the legacy `JavaSE-1.x` form (e.g. `'8'` → `'JavaSE-1.8'`).
 * - Java 9 and newer use the major number directly (e.g. `'17'` → `'JavaSE-17'`).
 * - Unparseable strings are returned as `JavaSE-<original>` unchanged.
 */
export function toJavaRuntimeName(version: string): string {
    const major = parseJavaVersionNumber(version);
    if (!major) {
        return `JavaSE-${version}`;
    }

    if (major <= 8) {
        return `JavaSE-1.${major}`;
    }

    return `JavaSE-${major}`;
}

/**
 * Maps a major Java version to the value Maven expects under
 * `<toolchains><toolchain><provides><version>...</version>`.
 *
 * Business rules:
 * - Java 8 and older use the legacy `1.x` form (e.g. `'8'` → `'1.8'`).
 * - Java 9 and newer use the major number alone (e.g. `'17'` → `'17'`).
 * - Unparseable strings are returned unchanged.
 */
export function toMavenToolchainVersion(version: string): string {
    const major = parseJavaVersionNumber(version);
    if (!major) {
        return version;
    }

    if (major <= 8) {
        return `1.${major}`;
    }

    return `${major}`;
}
