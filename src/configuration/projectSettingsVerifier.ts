import {parseJavaVersionNumber} from '../util/javaVersion';

/**
 * JDT preference key holding the compiler compliance level the Language
 * Server actually resolved for a project (e.g. `'1.8'`, `'17'`). Queried via
 * the `getProjectSettings` method of the redhat.java extension API.
 */
export const COMPILER_COMPLIANCE_KEY = 'org.eclipse.jdt.core.compiler.compliance';

/** The provisioned expectation for one project, taken from its `ProjectContext`. */
export interface ExpectedProjectSetup {
    projectPath: string;
    /** Java major version string the pom requested (e.g. `'17'`). */
    javaVersion: string;
}

/**
 * Result of checking one project against what the Language Server resolved.
 *
 * - `ok`: the resolved compliance matches the pom's Java version.
 * - `mismatch`: the Language Server compiled the project with a different
 *   Java level than Jaenvtix provisioned; the user should re-run or inspect.
 * - `unknown`: the setting could not be read (extension missing, LightWeight
 *   mode, or project not imported yet). Not an error: verification is
 *   best-effort and must never fail the pipeline.
 */
export interface ProjectVerification {
    projectPath: string;
    status: 'ok' | 'mismatch' | 'unknown';
    expectedMajor: number;
    actualCompliance?: string;
}

/**
 * Parses a JDT compiler compliance value to its Java major version.
 * JDT uses the legacy `1.x` form up to Java 8 (`'1.8'` → 8) and the plain
 * major from Java 9 on (`'17'` → 17). Returns 0 for unparseable input.
 */
export function parseJdtComplianceMajor(compliance: string): number {
    const legacyMatch = /^1\.(\d+)$/.exec(compliance);
    if (legacyMatch?.[1]) {
        return Number.parseInt(legacyMatch[1], 10);
    }

    return parseJavaVersionNumber(compliance);
}

/**
 * Compares the compiler compliance the Language Server resolved for a project
 * against the Java version its pom requested.
 *
 * Business rules:
 * - Only the compliance level is verified. The resolved VM path is
 *   deliberately NOT compared: a user may legitimately map the same Java
 *   version to a JDK of their own choosing in `java.configuration.runtimes`
 *   (which Jaenvtix preserves), and flagging that as a mismatch would be a
 *   false alarm.
 * - A missing/unreadable compliance value yields `unknown`, never `mismatch`:
 *   the server may still be importing or running in LightWeight mode.
 * - An unparseable expected version (pom quirk) also yields `unknown`;
 *   there is no reliable expectation to verify against.
 */
export function verifyProjectCompliance(
    expected: ExpectedProjectSetup,
    projectSettings: Record<string, unknown> | undefined,
): ProjectVerification {
    const expectedMajor = parseJavaVersionNumber(expected.javaVersion);
    const compliance = projectSettings?.[COMPILER_COMPLIANCE_KEY];

    if (expectedMajor === 0 || typeof compliance !== 'string' || compliance.length === 0) {
        return {projectPath: expected.projectPath, status: 'unknown', expectedMajor};
    }

    const actualMajor = parseJdtComplianceMajor(compliance);
    if (actualMajor === 0) {
        return {
            projectPath: expected.projectPath,
            status: 'unknown',
            expectedMajor,
            actualCompliance: compliance,
        };
    }

    return {
        projectPath: expected.projectPath,
        status: actualMajor === expectedMajor ? 'ok' : 'mismatch',
        expectedMajor,
        actualCompliance: compliance,
    };
}
