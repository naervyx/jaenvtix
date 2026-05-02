/**
 * Subset of `jdk-utils`'s `IJavaRuntime` that this module cares about.
 *
 * We deliberately do NOT import the upstream type so the pure selection
 * logic stays testable without pulling the (Node-only) `jdk-utils` package
 * into unit tests.
 */
export interface DetectedJdk {
    homedir: string;
    version?: { major?: number };
    /** True iff `<homedir>/bin/javac(.exe)` exists — JREs are excluded. */
    hasJavac?: boolean;
    isJdkHomeEnv?: boolean;
    isJavaHomeEnv?: boolean;
    isInPathEnv?: boolean;
    isFromSDKMAN?: boolean;
    isFromJENV?: boolean;
    isFromJabba?: boolean;
    isFromASDF?: boolean;
    isFromGradle?: boolean;
    isFromJBang?: boolean;
}

/**
 * Picks the best already-installed JDK for the target major version, or null
 * if nothing on the machine satisfies the requirement.
 *
 * Business rules:
 * - The candidate MUST be a JDK (`hasJavac === true`). JREs are useless to
 *   Maven and the Java Language Server.
 * - The candidate's `version.major` MUST match `targetMajor` exactly. We
 *   never substitute a higher minor/major.
 * - When several candidates qualify, prefer them in this order:
 *     1. JDK_HOME env var  (most explicit user intent)
 *     2. JAVA_HOME env var (next most explicit)
 *     3. PATH              (already on the user's daily path)
 *     4. SDKMAN / jEnv / jabba / asdf / gradle / jbang (managed installs)
 *     5. Anything else (e.g. /usr/lib/jvm scan results)
 * - Returns null when nothing matches. Caller should then fall back to the
 *   download flow.
 *
 * Pure: no I/O, no side effects.
 */
export function selectBestJdkForVersion(
    jdks: readonly DetectedJdk[],
    targetMajor: number
): DetectedJdk | null {
    const matches = jdks.filter(
        (jdk) => jdk.hasJavac === true && jdk.version?.major === targetMajor
    );

    if (matches.length === 0) {
        return null;
    }

    const byEnv: ((jdk: DetectedJdk) => boolean)[] = [
        (jdk) => jdk.isJdkHomeEnv === true,
        (jdk) => jdk.isJavaHomeEnv === true,
        (jdk) => jdk.isInPathEnv === true,
        (jdk) =>
            jdk.isFromSDKMAN === true ||
            jdk.isFromJENV === true ||
            jdk.isFromJabba === true ||
            jdk.isFromASDF === true ||
            jdk.isFromGradle === true ||
            jdk.isFromJBang === true,
    ];

    for (const predicate of byEnv) {
        const found = matches.find(predicate);
        if (found) {
            return found;
        }
    }

    return matches[0] ?? null;
}
