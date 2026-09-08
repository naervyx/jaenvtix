import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {buildVsCodeExtensionsPath} from '../../build/directory';
import {updateExtensionsJson} from '../../build/extensionsJsonWriter';
import {RECOMMENDED_EXTENSIONS} from '../../build/recommendedExtensions';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

/**
 * Recommended only when a Spring Boot application was detected: the
 * dashboard is dead weight in a plain Java/Maven workspace, but the natural
 * run/stop/debug hub in a Spring one.
 */
const SPRING_BOOT_DASHBOARD_EXTENSION_ID = 'vscjava.vscode-spring-boot-dashboard';

/**
 * Writes the curated extension catalog into each workspace root's
 * `.vscode/extensions.json` so VS Code itself suggests the companion
 * extensions to anyone opening the folder; the native counterpart of the
 * opt-in "Install Recommended Extensions" command.
 *
 * Business rules:
 * - Only workspace roots receive the file (one per distinct `workspace`
 *   among the project contexts); nested modules would duplicate noise VS
 *   Code never reads.
 * - The Spring Boot Dashboard is appended only when `ConfigureLaunchStep`
 *   detected a Spring Boot application (`state.springBootProjectDetected`),
 *   so this step must run after it.
 * - Delegates the non-destructive merge to `updateExtensionsJson`: existing
 *   recommendations and unrelated keys are preserved.
 */
export class RecommendExtensionsStep implements ConfigurationStep {
    readonly name = 'RecommendExtensions';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const workspaces = new Set(state.projectContexts.map((ctx) => ctx.workspace));
        const recommendedIds = RECOMMENDED_EXTENSIONS.map((extension) => extension.id);
        if (state.springBootProjectDetected) {
            recommendedIds.push(SPRING_BOOT_DASHBOARD_EXTENSION_ID);
        }

        for (const workspace of workspaces) {
            const result = updateExtensionsJson(buildVsCodeExtensionsPath(workspace), recommendedIds);
            if (result.updated) {
                log(Messages.Log.EXTENSIONS_JSON_UPDATED(workspace, result.added));
            }
        }

        return StepResult.success();
    }
}
