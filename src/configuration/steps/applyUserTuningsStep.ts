import {applyUserJavaTunings} from '../../build/vsCodeSettingsWriter';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';

// vscode.ConfigurationTarget.Global = 1; hardcoded so this module never imports
// `vscode` and stays loadable under plain Node in unit tests.
const CONFIG_TARGET_GLOBAL = 1;

/**
 * Minimal surface of `vscode.WorkspaceConfiguration` this step needs. The
 * orchestrator injects the real configuration; tests inject an in-memory fake.
 */
export interface UserConfig {
    get(key: string): unknown;
    update(key: string, value: unknown, target: number): Thenable<void>;
}

const TUNING_KEYS = [
    'java.debug.settings.hotCodeReplace',
    'java.maxConcurrentBuilds',
    'java.dependency.packagePresentation',
    'java.sources.organizeImports.staticStarThreshold',
    'java.test.config',
] as const;

/**
 * Applies sensible Java defaults to User Settings on first run.
 *
 * Business rules:
 * - Skipped entirely when the user opted out via `jaenvtix.applyJavaTunings: false`.
 * - `setIfUndefined` semantics: a key the user (or a previous run) already set
 *   is never overwritten — see `applyUserJavaTunings` for the tuning values.
 * - The `java.test.config` UTF-8 tuning is Windows-only.
 * - The configuration accessor is injected by the orchestrator
 *   (`getDefaultStepGroups`) so this module never imports `vscode` and stays
 *   loadable under plain Node in unit tests.
 */
export class ApplyUserTuningsStep implements ConfigurationStep {
    readonly name = 'ApplyUserTunings';

    constructor(
        private readonly configFactory: () => UserConfig,
        private readonly osPlatform: string = process.platform,
    ) {}

    async run(_state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const cfg = this.configFactory();

        if (cfg.get('jaenvtix.applyJavaTunings') === false) {
            return StepResult.success();
        }

        const current: Record<string, unknown> = {};
        for (const key of TUNING_KEYS) {
            current[key] = cfg.get(key);
        }

        const desired = applyUserJavaTunings(current, this.osPlatform);

        for (const [key, value] of Object.entries(desired)) {
            if (current[key] === undefined && value !== undefined) {
                await cfg.update(key, value, CONFIG_TARGET_GLOBAL);
            }
        }

        return StepResult.success();
    }
}
