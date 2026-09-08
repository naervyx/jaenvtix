import {join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {refreshAllProjects} from '../refreshProjectConfiguration';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

export interface RefreshProjectConfigurationDeps {
    /**
     * Executes `java.projectConfiguration.update` for one pom. Wired to
     * `vscode.commands.executeCommand` by the orchestrator.
     */
    refreshProject: (pomPath: string) => Promise<void>;
    /** Override the refresh concurrency pool size in tests. */
    refreshConcurrency?: number;
}

/**
 * After Jaenvtix has rewritten settings.json (and friends), nudge the Red Hat
 * Java Language Server to re-import the projects whose settings actually
 * changed, so the new runtime mapping takes effect without a window reload.
 *
 * Business rules:
 * - Only projects in `state.changedProjects` are refreshed: an idempotent
 *   re-run changed nothing, so there is nothing for the server to re-import
 *   and the step is an instant no-op. (Backlog-only runs also skip: the
 *   verification step re-READS those projects; re-importing an unchanged
 *   project would not change what the server resolved.)
 * - Relies on `AwaitLanguageServerStep` having already gated readiness:
 *   refreshes on `ready`, best-effort on `unconfirmed` (pre-gate behaviour),
 *   and skips silently on `extension-missing` / `lightweight` (nothing to
 *   notify) and on `timeout` (the orchestrator's continuation re-runs this
 *   step once the server finishes loading; never act on a loading server).
 * - Refresh calls run through a small concurrency pool; per-pom failures
 *   stay isolated and swallowed.
 */
export class RefreshProjectConfigurationStep implements ConfigurationStep {
    readonly name = 'RefreshProjectConfiguration';

    constructor(private readonly deps: RefreshProjectConfigurationDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.projectContexts.length === 0) {
            return StepResult.success();
        }

        const changedContexts = state.projectContexts
            .filter((ctx) => state.changedProjects.has(ctx.projectPath));
        if (changedContexts.length === 0) {
            log(Messages.Log.REFRESH_SKIPPED_NO_CHANGES);
            return StepResult.success();
        }

        const outcome = state.languageServerWait?.outcome;
        if (outcome === 'extension-missing' || outcome === 'lightweight' || outcome === 'timeout') {
            return StepResult.success();
        }

        const pomPaths = changedContexts.map((ctx) => join(ctx.projectPath, 'pom.xml'));
        await refreshAllProjects(pomPaths, this.deps.refreshProject, this.deps.refreshConcurrency);

        return StepResult.success();
    }
}
