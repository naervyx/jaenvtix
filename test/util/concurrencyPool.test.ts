import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {mapWithConcurrency} from '../../src/util/concurrencyPool';

// Business rules:
// - At most `limit` tasks in flight at any moment.
// - allSettled semantics: one failure never aborts the others.
// - Results come back in input order regardless of completion order.

describe('mapWithConcurrency', () => {
    it('never exceeds the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;

        await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
        });

        assert.ok(peak <= 3, `expected at most 3 in flight, saw ${peak}`);
        assert.ok(peak > 1, 'expected tasks to actually overlap');
    });

    it('preserves input order in the results even when completion order differs', async () => {
        const results = await mapWithConcurrency([30, 5, 15], 3, async (delay) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return delay * 2;
        });

        assert.deepEqual(
            results.map((entry) => entry.status === 'fulfilled' ? entry.value : entry.reason),
            [60, 10, 30],
        );
    });

    it('isolates failures per item (allSettled semantics)', async () => {
        const results = await mapWithConcurrency(['a', 'boom', 'c'], 2, async (item) => {
            if (item === 'boom') {
                throw new Error('exploded');
            }
            return item.toUpperCase();
        });

        assert.equal(results[0]?.status, 'fulfilled');
        assert.equal(results[1]?.status, 'rejected');
        assert.equal(results[2]?.status, 'fulfilled');
    });

    it('handles an empty input without invoking the task', async () => {
        let invoked = false;
        const results = await mapWithConcurrency([], 4, async () => {
            invoked = true;
        });

        assert.equal(invoked, false);
        assert.deepEqual(results, []);
    });

    it('clamps a limit larger than the input to the input size', async () => {
        const results = await mapWithConcurrency([1, 2], 100, async (item) => item + 1);
        assert.equal(results.length, 2);
        assert.equal(results.every((entry) => entry.status === 'fulfilled'), true);
    });
});
