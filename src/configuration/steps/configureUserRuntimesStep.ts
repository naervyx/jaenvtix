import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, JavaRuntime, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';
import {writeCooperatively} from '../../util/cooperativeWrite';
import {toJavaRuntimeName} from '../../util/javaVersion';
import {mergeUserRuntimes, validateAndCleanRuntimes} from '../../build/userRuntimesMerge';

/**
 * Minimal surface of the VS Code configuration APIs this step needs. The
 * orchestrator injects the real implementations; tests inject in-memory fakes
 * so this module never imports `vscode` and stays loadable under plain Node.
 */
export interface ConfigureUserRuntimesDeps {
    /**
     * Reads the User Settings (Global) layer of `java.configuration.runtimes`.
     * Must be the Global layer specifically, not the merged value: if a
     * `.code-workspace` (or folder settings) already declares runtimes, the
     * merged value would make this step conclude "nothing to add" and User
     * Settings would never be written. Wired to
     * `config.inspect('runtimes')?.globalValue`.
     */
    readGlobalRuntimes: () => JavaRuntime[] | undefined;
    /** Reads `jaenvtix.enableRuntimePathFix`, defaulting to true. */
    isPathFixEnabled: () => boolean;
    /**
     * Writes the merged list to User Settings. Wired to
     * `config.update('runtimes', value, ConfigurationTarget.Global)`.
     */
    writeGlobalRuntimes: (runtimes: JavaRuntime[]) => Thenable<void>;
    /** Override the platform probe. Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
}

/**
 * Populates the user-level `java.configuration.runtimes` with every JDK
 * Jaenvtix has staged in this run, so the Red Hat Language Server can resolve
 * each Maven project to the correct execution environment automatically.
 *
 * The merge with whatever the user already had is non-destructive — see
 * `mergeUserRuntimes` for the exact rules. The intent is cooperation: feed
 * the official extension the data it needs, never overwrite the user's own
 * choices.
 *
 * Business rules:
 * - `java.configuration.runtimes` is registered by `redhat.java`, which is not
 *   a hard dependency of Jaenvtix. When that extension is absent VS Code
 *   refuses the write, so the failure is logged and the step still succeeds:
 *   without a Language Server the setting has no consumer anyway, and failing
 *   here would abort every step that follows this one.
 */
export class ConfigureUserRuntimesStep implements ConfigurationStep {
    readonly name = 'ConfigureUserRuntimes';

    constructor(private readonly deps: ConfigureUserRuntimesDeps) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.versionPaths.size === 0) {
            return StepResult.success();
        }

        const candidates: JavaRuntime[] = [];
        for (const [version, paths] of state.versionPaths) {
            candidates.push({
                name: toJavaRuntimeName(version),
                path: paths.jdkHome,
            });
        }

        const existing = this.deps.readGlobalRuntimes() ?? [];
        const enableFix = this.deps.isPathFixEnabled();
        const platform = this.deps.platform ?? process.platform;
        const {kept, fixed, removed} = validateAndCleanRuntimes(existing, enableFix, platform);

        for (const {oldPath, entry} of fixed) {
            log(Messages.Log.RUNTIME_PATH_FIXED(oldPath, entry.path));
        }
        for (const entry of removed) {
            log(Messages.Log.RUNTIME_REMOVED(entry.name, entry.path));
        }

        const {merged, updated} = mergeUserRuntimes(kept, candidates);
        const changed = fixed.length > 0 || removed.length > 0 || updated;

        if (!changed) {
            return StepResult.success();
        }

        const written = await writeCooperatively(
            () => this.deps.writeGlobalRuntimes(merged),
            (detail) => Messages.Log.USER_RUNTIMES_SKIPPED(detail),
        );
        if (written) {
            log(Messages.Log.USER_RUNTIMES_UPDATED(merged.length));
        }

        return StepResult.success();
    }
}
