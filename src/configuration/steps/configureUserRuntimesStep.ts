import * as vscode from 'vscode';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, JavaRuntime, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';
import {toJavaRuntimeName} from '../../util/javaVersion';
import {mergeUserRuntimes, validateAndCleanRuntimes} from '../../build/userRuntimesMerge';

/**
 * Populates the user-level `java.configuration.runtimes` with every JDK
 * Jaenvtix has staged in this run, so the Red Hat Language Server can resolve
 * each Maven project to the correct execution environment automatically.
 *
 * The merge with whatever the user already had is non-destructive; see
 * `mergeUserRuntimes` for the exact rules. The intent is cooperation: feed
 * the official extension the data it needs, never overwrite the user's own
 * choices.
 */
export class ConfigureUserRuntimesStep implements ConfigurationStep {
    readonly name = 'ConfigureUserRuntimes';

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

        const config = vscode.workspace.getConfiguration('java.configuration');
        // CRITICAL: read SPECIFICALLY the Global (User Settings) layer, not
        // `config.get(...)` which returns the merged value across all scopes.
        // If a `.code-workspace` (or folder settings) already declares
        // `java.configuration.runtimes`, `config.get` would return that, and
        // our merge would conclude "nothing to add", so User Settings would
        // never be written. Inspect lets us look only at the Global layer.
        const inspected = config.inspect<JavaRuntime[]>('runtimes');
        const existing = inspected?.globalValue ?? [];

        const enableFix = vscode.workspace.getConfiguration('jaenvtix').get<boolean>('enableRuntimePathFix', true);
        const {kept, fixed, removed} = validateAndCleanRuntimes(existing, enableFix, process.platform);

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

        await config.update('runtimes', merged, vscode.ConfigurationTarget.Global);
        log(Messages.Log.USER_RUNTIMES_UPDATED(merged.length));
        return StepResult.success();
    }
}
