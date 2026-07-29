import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {
    DEFAULT_SERVER_READY_TIMEOUT_MS,
    RedhatApiResolver,
    ServerReadyOutcome,
    waitForRedhatServerReady,
} from '../serverReadyGate';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

export interface AwaitLanguageServerDeps {
    /**
     * Resolves the activated redhat.java extension API (or `undefined` when
     * the extension is not installed). Wired by the orchestrator; tests
     * inject fakes.
     */
    resolveRedhatApi: RedhatApiResolver;
    /**
     * Reads the mismatch backlog recorded by the previous run's
     * verification. Wired to the workspaceState-backed accessor.
     */
    getMismatchBacklog: () => readonly string[];
    /** Override the serverReady wait budget in tests. */
    serverReadyTimeoutMs?: number;
}

/**
 * Decides whether this run needs the Red Hat Java Language Server at all
 * and, only then, waits for it — inside the progress notification, under its
 * own explicit label ("Waiting for the Java Language Server…").
 *
 * Business rules:
 * - The server is needed only when at least one project's settings changed
 *   this run OR the previous run flagged a project with a compliance
 *   mismatch (backlog). Idempotent re-runs skip the wait entirely — this is
 *   what keeps multi-repo reopens instant.
 * - The backlog is narrowed to projects that still exist in the current
 *   contexts; entries for vanished projects stay recorded and simply resume
 *   mattering if the project reappears (the mismatch was never resolved).
 * - The wait outcome is stored on the state for the refresh and verification
 *   steps; this step itself never fails the pipeline.
 * - Each outcome is logged here, once, so downstream steps can skip silently.
 */
export class AwaitLanguageServerStep implements ConfigurationStep {
    readonly name = 'AwaitLanguageServer';

    constructor(private readonly deps: AwaitLanguageServerDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const contextPaths = new Set(state.projectContexts.map((ctx) => ctx.projectPath));
        state.verificationBacklog = this.deps.getMismatchBacklog()
            .filter((projectPath) => contextPaths.has(projectPath));

        const serverNeeded = state.changedProjects.size > 0 || state.verificationBacklog.length > 0;
        if (!serverNeeded) {
            return StepResult.success();
        }

        state.languageServerWait = await waitForRedhatServerReady(
            this.deps.resolveRedhatApi,
            this.deps.serverReadyTimeoutMs,
        );
        logWaitOutcome(state.languageServerWait.outcome, this.deps.serverReadyTimeoutMs);

        return StepResult.success();
    }
}

function logWaitOutcome(outcome: ServerReadyOutcome, timeoutMs: number | undefined): void {
    if (outcome === 'extension-missing') {
        log(Messages.Log.REFRESH_SKIPPED_REDHAT_MISSING);
        return;
    }

    if (outcome === 'lightweight') {
        log(Messages.Log.VERIFY_SKIPPED_LIGHTWEIGHT);
        return;
    }

    if (outcome === 'timeout') {
        log(Messages.Log.SERVER_READY_TIMEOUT_DEFERRED(timeoutMs ?? DEFAULT_SERVER_READY_TIMEOUT_MS));
        return;
    }

    if (outcome === 'unconfirmed') {
        log(Messages.Log.SERVER_READY_UNCONFIRMED);
    }
}
