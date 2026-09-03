import {applyUserJavaTunings} from '../../build/vsCodeSettingsWriter';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {writeCooperatively} from '../../util/cooperativeWrite';
import {Messages} from '../../util/message';

// vscode.ConfigurationTarget.Global = 1; hardcoded so this module never imports
// `vscode` and stays loadable under plain Node in unit tests.
const CONFIG_TARGET_GLOBAL = 1;

/**
 * Minimal surface of `vscode.WorkspaceConfiguration` this step needs. The
 * orchestrator injects the real configuration; tests inject an in-memory fake.
 * `inspect` is required (over `get`) to distinguish "user never set this"
 * from "the owning extension registered a default value" — `get` returns the
 * registered default, which would make every tuning look already-set once
 * the Java extension pack is installed.
 */
export interface UserConfig {
    get(key: string): unknown;
    inspect(key: string): {
        globalValue?: unknown;
        workspaceValue?: unknown;
        workspaceFolderValue?: unknown;
    } | undefined;
    update(key: string, value: unknown, target: number): Thenable<void>;
}

const TUNING_KEYS = [
    'java.debug.settings.hotCodeReplace',
    'java.maxConcurrentBuilds',
    'java.dependency.packagePresentation',
    'java.sources.organizeImports.staticStarThreshold',
    'java.test.config',
] as const;

/** The value the user explicitly set at any scope, or `undefined` when unset. */
function userSetValue(cfg: UserConfig, key: string): unknown {
    const info = cfg.inspect(key);
    return info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue;
}

/**
 * Writes one tuning, isolating its failure from the remaining keys. The five
 * tunings belong to four different extensions of the Java pack, so a partial
 * install refuses some keys and accepts others (`java.test.config` is
 * registered by vscjava.vscode-java-test). See `writeCooperatively`.
 */
async function writeTuning(cfg: UserConfig, key: string, value: unknown): Promise<void> {
    await writeCooperatively(
        () => cfg.update(key, value, CONFIG_TARGET_GLOBAL),
        (detail) => Messages.Log.TUNING_SKIPPED(key, detail),
    );
}

/**
 * Applies sensible Java defaults to User Settings on first run.
 *
 * Business rules:
 * - Skipped entirely when the user opted out via `jaenvtix.applyJavaTunings: false`.
 * - `setIfUndefined` semantics against what the USER set (via `inspect`),
 *   not against the owning extension's registered default — see `UserConfig`.
 * - The hotCodeReplace tuning is gated on the EFFECTIVE
 *   `java.autobuild.enabled` value (via `get`): auto HCR only acts after an
 *   automatic build, so a user who disabled autobuild anywhere must not
 *   receive it.
 * - The `java.test.config` UTF-8 tuning is Windows-only.
 * - Each tuning is written independently: a key VS Code refuses because no
 *   installed extension registered it is logged and skipped, and the step
 *   still succeeds. Failing here would abort the pipeline before the five
 *   remaining steps, among them the extension recommendations and the doctor.
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
            current[key] = userSetValue(cfg, key);
        }
        // Effective value (registered default included) — this one gates a
        // tuning instead of being tuned itself, and is never written back.
        current['java.autobuild.enabled'] = cfg.get('java.autobuild.enabled');

        const desired = applyUserJavaTunings(current, this.osPlatform);

        for (const key of TUNING_KEYS) {
            const value = desired[key];
            if (current[key] === undefined && value !== undefined) {
                await writeTuning(cfg, key, value);
            }
        }

        return StepResult.success();
    }
}
