import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    COMPILER_COMPLIANCE_KEY,
    ProjectVerification,
    verifyProjectCompliance,
} from '../projectSettingsVerifier';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

export interface VerifyConfigurationDeps {
    /**
     * Reads JDT project settings via the redhat.java extension API
     * (`getProjectSettings`). Returns `undefined` when the API is unavailable
     * (extension missing, LightWeight mode, or an API version without the
     * method). The orchestrator wires the real call; tests inject fakes.
     */
    readProjectSettings: (
        projectPath: string,
        settingKeys: string[],
    ) => Promise<Record<string, unknown> | undefined>;
    /**
     * Surfaces an aggregated mismatch summary to the user. Wired to
     * `vscode.window.showWarningMessage` by the orchestrator.
     */
    notifyMismatch: (message: string) => void;
}

/**
 * Post-configuration health check ("doctor"): asks the Red Hat Language
 * Server which compiler compliance it actually resolved for each project and
 * compares it with the Java version Jaenvtix provisioned.
 *
 * Business rules:
 * - Best-effort by design: every failure path degrades to a log line, never
 *   to a pipeline warning/error — verification is cooperative, not core.
 * - Per-project results are logged individually; the user-facing toast is a
 *   single aggregated warning shown only when at least one project
 *   mismatches (avoids toast spam in large monorepos).
 * - `unknown` results (server still importing, LightWeight mode, extension
 *   missing) are logged as skipped, not counted as mismatches.
 */
export class VerifyConfigurationStep implements ConfigurationStep {
    readonly name = 'VerifyConfiguration';

    constructor(private readonly deps: VerifyConfigurationDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.projectContexts.length === 0) {
            return StepResult.success();
        }

        const verifications: ProjectVerification[] = [];
        for (const projectContext of state.projectContexts) {
            let projectSettings: Record<string, unknown> | undefined;
            try {
                projectSettings = await this.deps.readProjectSettings(
                    projectContext.projectPath,
                    [COMPILER_COMPLIANCE_KEY],
                );
            } catch {
                projectSettings = undefined;
            }

            verifications.push(verifyProjectCompliance(
                {projectPath: projectContext.projectPath, javaVersion: projectContext.javaVersion},
                projectSettings,
            ));
        }

        for (const verification of verifications) {
            logVerification(verification);
        }

        const mismatchCount = verifications.filter((entry) => entry.status === 'mismatch').length;
        if (mismatchCount > 0) {
            this.deps.notifyMismatch(Messages.Warning.PROJECT_VERIFICATION_MISMATCH(mismatchCount));
        }

        return StepResult.success();
    }
}

function logVerification(verification: ProjectVerification): void {
    if (verification.status === 'ok') {
        log(Messages.Log.VERIFY_PROJECT_OK(verification.projectPath, verification.expectedMajor));
        return;
    }

    if (verification.status === 'mismatch') {
        log(Messages.Log.VERIFY_PROJECT_MISMATCH(
            verification.projectPath,
            verification.expectedMajor,
            verification.actualCompliance ?? '',
        ));
        return;
    }

    log(Messages.Log.VERIFY_PROJECT_SKIPPED(verification.projectPath));
}
