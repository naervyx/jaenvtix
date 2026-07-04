import {join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {refreshAllProjects} from '../refreshProjectConfiguration';
import {RedhatApiResolver, waitForRedhatServerReady} from '../serverReadyGate';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

export interface RefreshProjectConfigurationDeps {
    /**
     * Resolves the activated redhat.java extension API (or `undefined` when
     * the extension is not installed). Wired by the orchestrator; tests
     * inject fakes.
     */
    resolveRedhatApi: RedhatApiResolver;
    /**
     * Executes `java.projectConfiguration.update` for one pom. Wired to
     * `vscode.commands.executeCommand` by the orchestrator.
     */
    refreshProject: (pomPath: string) => Promise<void>;
    /** Override the serverReady wait budget in tests. */
    serverReadyTimeoutMs?: number;
}

/**
 * After Jaenvtix has rewritten settings.json (and friends), nudge the Red Hat
 * Java Language Server to re-import each project so the new runtime mapping
 * takes effect immediately. Without this, the user has to reload the window
 * to see the new classpath.
 *
 * Business rules:
 * - Waits for the Language Server to signal `serverReady` before refreshing:
 *   the auto-configuration typically runs on first workspace open, exactly
 *   when the server is still starting, and refresh commands issued too early
 *   are rejected. The wait is bounded — on timeout the refresh is attempted
 *   anyway (pre-gate behaviour), and per-pom failures stay swallowed.
 * - When the Red Hat extension is not installed the refresh is skipped
 *   entirely (there is no server to notify) with an auditable log line.
 */
export class RefreshProjectConfigurationStep implements ConfigurationStep {
    readonly name = 'RefreshProjectConfiguration';

    constructor(private readonly deps: RefreshProjectConfigurationDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.projectContexts.length === 0) {
            return StepResult.success();
        }

        const outcome = await waitForRedhatServerReady(
            this.deps.resolveRedhatApi,
            this.deps.serverReadyTimeoutMs,
        );

        if (outcome === 'extension-missing') {
            log(Messages.Log.REFRESH_SKIPPED_REDHAT_MISSING);
            return StepResult.success();
        }

        if (outcome === 'unconfirmed') {
            log(Messages.Log.SERVER_READY_UNCONFIRMED);
        }

        const pomPaths = state.projectContexts.map((ctx) => join(ctx.projectPath, 'pom.xml'));
        await refreshAllProjects(pomPaths, this.deps.refreshProject);

        return StepResult.success();
    }
}
