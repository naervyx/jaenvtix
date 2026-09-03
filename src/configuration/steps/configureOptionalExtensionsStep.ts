import {
    detectOptionalExtensionConfig,
    selectInitializrDefaultJavaVersion,
    selectLanguageServerJdkHome,
} from '../../build/optionalExtensionsConfig';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {log} from '../../util/logger';
import {Messages} from '../../util/message';
import {writeCooperatively} from '../../util/cooperativeWrite';

// vscode.ConfigurationTarget.Global = 1; hardcoded so this module never imports
// `vscode` and stays loadable under plain Node in unit tests.
const CONFIG_TARGET_GLOBAL = 1;

/**
 * Minimal surface of `vscode.WorkspaceConfiguration` this step needs. The
 * orchestrator injects the real configuration; tests inject an in-memory fake.
 * `inspect` is required (over `get`) to distinguish "user never set this"
 * from "the owning extension registered a default value".
 */
export interface OptionalExtensionsUserConfig {
    get(key: string): unknown;
    inspect(key: string): {globalValue?: unknown} | undefined;
    update(key: string, value: unknown, target: number): Thenable<void>;
}

/**
 * Configures companion extensions via User Settings: points Spring Boot
 * Tools at a Java 21+ JDK provisioned by the pipeline and seeds the Spring
 * Initializr default Java version with the workspace's best LTS.
 *
 * Business rules:
 * - Skipped entirely when the user opted out via
 *   `jaenvtix.configureOptionalExtensions: false`.
 * - Writes only settings of extensions actually installed; absent extensions
 *   produce no writes.
 * - A value the user already set globally is never overwritten — only the
 *   `globalValue` is checked, because the owning extension's registered
 *   default would mask "never set" if read through `get`.
 * - No qualifying JDK → nothing to write (see the selectors in
 *   `optionalExtensionsConfig` for the per-extension rules).
 * - The installed check narrows the risk of writing an unregistered setting
 *   but does not remove it: `vmware.vscode-boot-dev-pack` is a pack, and the
 *   member that registers `spring-boot.ls.java.home` can be uninstalled while
 *   the pack stays. Every write therefore goes through `writeCooperatively`,
 *   which logs a refusal and lets the run continue.
 */
export class ConfigureOptionalExtensionsStep implements ConfigurationStep {
    readonly name = 'ConfigureOptionalExtensions';

    constructor(
        private readonly configFactory: () => OptionalExtensionsUserConfig,
        private readonly isExtensionInstalled: (extensionId: string) => boolean,
    ) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const cfg = this.configFactory();

        if (cfg.get('jaenvtix.configureOptionalExtensions') === false) {
            return StepResult.success();
        }

        const updates = detectOptionalExtensionConfig(
            {
                languageServerJdkHome: selectLanguageServerJdkHome(state.versionPaths),
                initializrDefaultJavaVersion: selectInitializrDefaultJavaVersion(state.versionPaths),
            },
            this.isExtensionInstalled,
        );

        for (const {settingKey, value, extensionId} of updates) {
            if (cfg.inspect(settingKey)?.globalValue !== undefined) {
                continue;
            }

            const written = await writeCooperatively(
                () => cfg.update(settingKey, value, CONFIG_TARGET_GLOBAL),
                (detail) => Messages.Log.OPTIONAL_EXTENSION_SKIPPED(settingKey, extensionId, detail),
            );
            if (written) {
                log(Messages.Log.OPTIONAL_EXTENSION_CONFIGURED(settingKey, extensionId, value));
            }
        }

        return StepResult.success();
    }
}
