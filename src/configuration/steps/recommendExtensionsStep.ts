import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {buildVsCodeExtensionsPath} from '../../build/directory';
import {updateExtensionsJson} from '../../build/extensionsJsonWriter';
import {RECOMMENDED_EXTENSIONS} from '../../build/recommendedExtensions';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';

/**
 * Writes the curated extension catalog into each workspace root's
 * `.vscode/extensions.json` so VS Code itself suggests the companion
 * extensions to anyone opening the folder — the native counterpart of the
 * opt-in "Install Recommended Extensions" command.
 *
 * Business rules:
 * - Only workspace roots receive the file (one per distinct `workspace`
 *   among the project contexts); nested modules would duplicate noise VS
 *   Code never reads.
 * - Delegates the non-destructive merge to `updateExtensionsJson`: existing
 *   recommendations and unrelated keys are preserved.
 */
export class RecommendExtensionsStep implements ConfigurationStep {
    readonly name = 'RecommendExtensions';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const workspaces = new Set(state.projectContexts.map((ctx) => ctx.workspace));
        const recommendedIds = RECOMMENDED_EXTENSIONS.map((extension) => extension.id);

        for (const workspace of workspaces) {
            const result = updateExtensionsJson(buildVsCodeExtensionsPath(workspace), recommendedIds);
            if (result.updated) {
                log(Messages.Log.EXTENSIONS_JSON_UPDATED(workspace, result.added));
            }
        }

        return StepResult.success();
    }
}
