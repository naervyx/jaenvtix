export const TOOLING_JAVA_MIN_VERSION = 21;

function parseJavaVersionNumber(version: string): number {
    const parsed = Number.parseInt(version, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function isJavaVersionAtLeast(version: string, minimum: number): boolean {
    return parseJavaVersionNumber(version) >= minimum;
}

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
 * Java 8 and older use the legacy `1.x` form; modern releases use the
 * major number alone.
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
