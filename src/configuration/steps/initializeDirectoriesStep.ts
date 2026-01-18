import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {initializeBaseDirectories} from '../../build/directory';

export class InitializeDirectoriesStep implements ConfigurationStep {
    readonly name = 'InitializeDirectories';

    async run(_state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        initializeBaseDirectories();
        return StepResult.success();
    }
}
