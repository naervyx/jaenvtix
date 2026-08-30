import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../core/types';
import {Messages} from '../util/message';

function getStepLabel(step: ConfigurationStep): string {
    return Messages.Progress.STEPS[step.name] ?? step.name;
}

/**
 * Run a single step and convert any thrown exception into a uniform
 * ConfigurationStepResult error. Centralised so the orchestrator and
 * tests share the same wrapping behaviour.
 */
export async function runStep(
    step: ConfigurationStep,
    state: JavaConfigurationState
): Promise<ConfigurationStepResult> {
    try {
        return await step.run(state);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return StepResult.error(Messages.Error.STEP_FAILED(getStepLabel(step), message));
    }
}

/**
 * Run a sequence of steps until either all succeed or one returns a
 * non-success result. The first non-success short-circuits and is returned
 * verbatim, preserving its kind/message so downstream UI can decide
 * whether to surface it as a warning or an error.
 */
export async function runSteps(
    steps: ConfigurationStep[],
    state: JavaConfigurationState
): Promise<ConfigurationStepResult> {
    for (const step of steps) {
        const result = await runStep(step, state);
        if (!result.success) {
            return result;
        }
    }

    return StepResult.success();
}
