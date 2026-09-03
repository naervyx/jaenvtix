import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {writeCooperatively} from '../../src/util/cooperativeWrite';
import {setLogSink} from '../../src/util/logger';

/** Captures the log lines the helper emits, restoring the console sink after. */
function captureLog(): string[] {
    const lines: string[] = [];
    setLogSink((message) => { lines.push(message); });
    return lines;
}

afterEach(() => {
    setLogSink((message) => console.log(message));
});

describe('writeCooperatively', () => {
    it('reports true and logs nothing when the write lands', async () => {
        const lines = captureLog();
        let written: string | undefined;

        const result = await writeCooperatively(
            async () => { written = 'value'; },
            () => 'should not be logged',
        );

        assert.equal(result, true);
        assert.equal(written, 'value');
        assert.deepEqual(lines, []);
    });

    it('reports false and logs the described failure when the write is refused', async () => {
        const lines = captureLog();

        const result = await writeCooperatively(
            async () => {
                throw new Error('Unable to write to User Settings because java.test.config is not a registered configuration.');
            },
            (detail) => `refused: ${detail}`,
        );

        assert.equal(result, false);
        assert.deepEqual(lines, [
            'refused: Unable to write to User Settings because java.test.config is not a registered configuration.',
        ]);
    });

    it('describes a non-Error rejection through String()', async () => {
        const lines = captureLog();

        const result = await writeCooperatively(
            () => Promise.reject('plain string rejection'),
            (detail) => `refused: ${detail}`,
        );

        assert.equal(result, false);
        assert.deepEqual(lines, ['refused: plain string rejection']);
    });

    it('never rethrows, so a caller can keep going', async () => {
        captureLog();
        const order: string[] = [];

        for (const key of ['a', 'b', 'c']) {
            await writeCooperatively(
                async () => {
                    if (key === 'a') { throw new Error('refused'); }
                    order.push(key);
                },
                () => `skipped ${key}`,
            );
        }

        assert.deepEqual(order, ['b', 'c']);
    });
});
