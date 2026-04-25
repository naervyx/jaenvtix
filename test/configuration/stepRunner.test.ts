import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {runStep, runSteps} from '../../src/configuration/stepRunner';
import {
    ConfigurationStep,
    ConfigurationStepResult,
    JavaConfigurationState,
    StepResult,
    createInitialState,
} from '../../src/core/types';

function makeState(): JavaConfigurationState {
    return createInitialState();
}

class StubStep implements ConfigurationStep {
    public ran = false;
    constructor(
        public readonly name: string,
        private readonly produce: () => ConfigurationStepResult | Promise<ConfigurationStepResult>,
    ) {}
    async run(): Promise<ConfigurationStepResult> {
        this.ran = true;
        return await this.produce();
    }
}

class ThrowingStep implements ConfigurationStep {
    public ran = false;
    constructor(public readonly name: string, private readonly error: unknown) {}
    async run(): Promise<ConfigurationStepResult> {
        this.ran = true;
        throw this.error;
    }
}

describe('runStep', () => {
    it('returns the step result on success', async () => {
        const step = new StubStep('A', () => StepResult.success());
        const result = await runStep(step, makeState());
        assert.equal(result.success, true);
        assert.equal(step.ran, true);
    });

    it('wraps a thrown Error into a StepResult.error labelled with the step name', async () => {
        const step = new ThrowingStep('A', new Error('boom'));
        const result = await runStep(step, makeState());
        assert.equal(result.success, false);
        assert.equal(result.kind, 'error');
        assert.match(result.message ?? '', /A.*boom/);
    });

    it('wraps a thrown non-Error value via String() coercion', async () => {
        const step = new ThrowingStep('A', 'string-error');
        const result = await runStep(step, makeState());
        assert.equal(result.success, false);
        assert.match(result.message ?? '', /string-error/);
    });

    it('passes through a step warning unchanged', async () => {
        const step = new StubStep('A', () => StepResult.warning('cancelled'));
        const result = await runStep(step, makeState());
        assert.equal(result.success, false);
        assert.equal(result.kind, 'warning');
        assert.equal(result.message, 'cancelled');
    });
});

describe('runSteps', () => {
    it('runs all steps in order when each succeeds', async () => {
        const trace: string[] = [];
        const steps = [
            new StubStep('A', () => {trace.push('A'); return StepResult.success();}),
            new StubStep('B', () => {trace.push('B'); return StepResult.success();}),
            new StubStep('C', () => {trace.push('C'); return StepResult.success();}),
        ];

        const result = await runSteps(steps, makeState());

        assert.equal(result.success, true);
        assert.deepEqual(trace, ['A', 'B', 'C']);
    });

    it('short-circuits at the first failure (warning)', async () => {
        const trace: string[] = [];
        const stepA = new StubStep('A', () => {trace.push('A'); return StepResult.success();});
        const stepB = new StubStep('B', () => {trace.push('B'); return StepResult.warning('stop here');});
        const stepC = new StubStep('C', () => {trace.push('C'); return StepResult.success();});

        const result = await runSteps([stepA, stepB, stepC], makeState());

        assert.equal(result.success, false);
        assert.equal(result.kind, 'warning');
        assert.equal(result.message, 'stop here');
        assert.deepEqual(trace, ['A', 'B']);
        assert.equal(stepC.ran, false);
    });

    it('short-circuits at the first failure (error)', async () => {
        const stepA = new StubStep('A', () => StepResult.success());
        const stepB = new StubStep('B', () => StepResult.error('fatal'));
        const stepC = new StubStep('C', () => StepResult.success());

        const result = await runSteps([stepA, stepB, stepC], makeState());

        assert.equal(result.kind, 'error');
        assert.equal(result.message, 'fatal');
        assert.equal(stepC.ran, false);
    });

    it('short-circuits at the first thrown exception', async () => {
        const stepA = new StubStep('A', () => StepResult.success());
        const stepB = new ThrowingStep('B', new Error('uh oh'));
        const stepC = new StubStep('C', () => StepResult.success());

        const result = await runSteps([stepA, stepB, stepC], makeState());

        assert.equal(result.success, false);
        assert.equal(result.kind, 'error');
        assert.match(result.message ?? '', /uh oh/);
        assert.equal(stepC.ran, false);
    });

    it('returns success on an empty step list', async () => {
        const result = await runSteps([], makeState());
        assert.equal(result.success, true);
    });

    it('threads the same state through every step (state mutation visible to next step)', async () => {
        const stepA = new StubStep('A', () => StepResult.success());
        const stepB = new StubStep('B', () => StepResult.success());
        const state = makeState();
        state.workspaceFolders = ['initial'];

        // Replace stepA's run to mutate state
        stepA.run = async () => {
            state.workspaceFolders.push('from-A');
            return StepResult.success();
        };
        stepB.run = async () => {
            assert.deepEqual(state.workspaceFolders, ['initial', 'from-A']);
            return StepResult.success();
        };

        const result = await runSteps([stepA, stepB], state);
        assert.equal(result.success, true);
    });
});
