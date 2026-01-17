import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from './types';

export class JavaConfigurationWorkflow {
    constructor(private readonly steps: ConfigurationStep[]) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        for (const step of this.steps) {
            try {
                const result = await step.run(state);
                if (!result.success) {
                    return result;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return StepResult.error(`${step.name} failed: ${message}`);
            }
        }

        return StepResult.success();
    }
}
