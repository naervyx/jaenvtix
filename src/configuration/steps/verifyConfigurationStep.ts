import {existsSync} from 'node:fs';
import {basename, join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, ProjectContext, StepResult} from '../../core/types';
import {
    COMPILER_COMPLIANCE_KEY,
    ProjectVerification,
    verifyProjectCompliance,
} from '../projectSettingsVerifier';
import {DEFAULT_CONCURRENCY_LIMIT, mapWithConcurrency} from '../../util/concurrencyPool';
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
     * Surfaces the mismatch summary to the user. The orchestrator wires it
     * to an information toast carrying [Restart Language Server] and
     * [Show Logs] actions — restarting is the fix, so the message must not
     * read like an error.
     */
    notifyMismatch: (message: string) => void;
    /**
     * Persists the mismatch backlog for the next run (empty list clears it).
     * Wired to the workspaceState-backed accessor.
     */
    updateMismatchMemento: (projectPaths: readonly string[]) => Promise<void> | void;
    /**
     * Whether the project has `src/main/java` (i.e. compiles sources at
     * all). Defaults to a filesystem probe; injectable for tests.
     */
    hasMainJavaSources?: (projectPath: string) => boolean;
    /** Override the read concurrency pool size in tests. */
    verifyConcurrency?: number;
}

/**
 * Post-configuration health check ("doctor"): asks the Red Hat Language
 * Server which compiler compliance it actually resolved for each project and
 * compares it with the Java version Jaenvtix provisioned.
 *
 * Business rules:
 * - Best-effort by design: every failure path degrades to a log line, never
 *   to a pipeline warning/error — verification is cooperative, not core.
 * - Verifies only projects that changed this run plus the backlog flagged by
 *   the previous run — the physical environment is already re-provisioned on
 *   every run by the earlier steps; what the server RESOLVED only moves when
 *   settings change or the server restarts, so anything else is a no-op.
 * - Never verifies by the clock: on `timeout` the step defers entirely to
 *   the orchestrator's serverReady continuation (reading now would race the
 *   server's own import and produce false alarms). `extension-missing` and
 *   `lightweight` skip silently (already logged by AwaitLanguageServerStep).
 * - Aggregator projects (no `src/main/java`) are skipped with a log line:
 *   JDT resolves a default tooling compliance for them, which is not a
 *   Jaenvtix mismatch.
 * - Memento: mismatches found now are recorded for the next run; a flagged
 *   project that now verifies `ok` is cleared; a flagged project whose
 *   answer is `unknown` STAYS flagged — an unreadable answer is not a
 *   resolution.
 * - Reads run through a small concurrency pool; per-project results are
 *   logged individually; the user-facing toast is a single message naming
 *   the project (or the count when several mismatch) with the restart
 *   action, never one toast per project.
 */
export class VerifyConfigurationStep implements ConfigurationStep {
    readonly name = 'VerifyConfiguration';

    constructor(private readonly deps: VerifyConfigurationDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.projectContexts.length === 0) {
            return StepResult.success();
        }

        const backlog = new Set(state.verificationBacklog);
        const targets = state.projectContexts.filter((ctx) =>
            state.changedProjects.has(ctx.projectPath) || backlog.has(ctx.projectPath));
        if (targets.length === 0) {
            return StepResult.success();
        }

        const outcome = state.languageServerWait?.outcome;
        if (outcome === 'extension-missing' || outcome === 'lightweight' || outcome === 'timeout') {
            return StepResult.success();
        }

        if (state.verificationBacklog.length > 0) {
            log(Messages.Log.VERIFY_BACKLOG_RESUMED(state.verificationBacklog.length));
        }

        const verifications = await this.verifyTargets(targets);
        for (const verification of verifications) {
            logVerification(verification);
        }

        await this.deps.updateMismatchMemento(nextBacklog(verifications, backlog));

        const mismatches = verifications.filter((entry) => entry.status === 'mismatch');
        if (mismatches.length > 0) {
            this.deps.notifyMismatch(buildMismatchMessage(mismatches));
            state.mismatchNotified = true;
        }

        return StepResult.success();
    }

    private async verifyTargets(targets: ProjectContext[]): Promise<ProjectVerification[]> {
        const hasMainJavaSources = this.deps.hasMainJavaSources ?? defaultHasMainJavaSources;
        const concurrency = this.deps.verifyConcurrency ?? DEFAULT_CONCURRENCY_LIMIT;

        const settled = await mapWithConcurrency(targets, concurrency, async (projectContext) => {
            if (!hasMainJavaSources(projectContext.projectPath)) {
                log(Messages.Log.VERIFY_PROJECT_NO_SOURCES(projectContext.projectPath));
                return undefined;
            }

            let projectSettings: Record<string, unknown> | undefined;
            try {
                projectSettings = await this.deps.readProjectSettings(
                    projectContext.projectPath,
                    [COMPILER_COMPLIANCE_KEY],
                );
            } catch {
                projectSettings = undefined;
            }

            return verifyProjectCompliance(
                {projectPath: projectContext.projectPath, javaVersion: projectContext.javaVersion},
                projectSettings,
            );
        });

        return settled
            .filter((result): result is PromiseFulfilledResult<ProjectVerification | undefined> =>
                result.status === 'fulfilled')
            .map((result) => result.value)
            .filter((verification): verification is ProjectVerification => verification !== undefined);
    }
}

function defaultHasMainJavaSources(projectPath: string): boolean {
    return existsSync(join(projectPath, 'src', 'main', 'java'));
}

/**
 * Computes the backlog to persist: every mismatch found now, plus previously
 * flagged projects whose answer came back `unknown` (couldn't confirm the
 * mismatch was resolved). Projects that verified `ok` — or were skipped as
 * aggregators, which can never verify — drop off.
 */
function nextBacklog(
    verifications: readonly ProjectVerification[],
    previousBacklog: ReadonlySet<string>,
): string[] {
    return verifications
        .filter((entry) =>
            entry.status === 'mismatch' ||
            (entry.status === 'unknown' && previousBacklog.has(entry.projectPath)))
        .map((entry) => entry.projectPath);
}

function buildMismatchMessage(mismatches: readonly ProjectVerification[]): string {
    const first = mismatches[0] as ProjectVerification;
    if (mismatches.length === 1) {
        return Messages.Info.PROJECT_VERIFICATION_MISMATCH(
            basename(first.projectPath),
            first.actualCompliance ?? 'another level',
            first.expectedMajor,
        );
    }

    return Messages.Info.PROJECT_VERIFICATION_MISMATCH_MANY(mismatches.length);
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
