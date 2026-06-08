import {applyUserJavaTunings} from '../../build/settingTag';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';

// vscode.ConfigurationTarget.Global = 1; hardcoded to avoid a top-level vscode import
// so the module can be loaded in the test environment (no extension host required).
const CONFIG_TARGET_GLOBAL = 1;

interface UserConfig {
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

export class ApplyUserTuningsStep implements ConfigurationStep {
    readonly name = 'ApplyUserTunings';

    constructor(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        private readonly configFactory: () => UserConfig = () => (require('vscode') as typeof import('vscode')).workspace.getConfiguration(),
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
