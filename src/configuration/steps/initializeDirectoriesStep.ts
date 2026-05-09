import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {initializeBaseDirectories} from '../../build/directory';

/**
 * Creates the Jaenvtix root cache directory, temp directory, and `~/.m2/` before
 * any download or file-write step runs, ensuring they exist and are writable.
 */
export class InitializeDirectoriesStep implements ConfigurationStep {
    readonly name = 'InitializeDirectories';

    async run(_state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        initializeBaseDirectories();
        return StepResult.success();
    }
}
