import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {waitForRedhatServerReady} from '../../src/configuration/serverReadyGate';

// Business rules:
// - Extension absent → 'extension-missing' (callers skip Language Server work).
// - LightWeight mode → 'lightweight' immediately: the Standard server never
//   starts, so waiting would always time out. Correct no-op, user's choice.
// - Activation failure, old API without serverReady, or rejection →
//   'unconfirmed' so callers proceed best-effort, exactly as Jaenvtix behaved
//   before the gate existed.
// - serverReady resolving in time → 'ready'.
// - Timeout → 'timeout' + a live `becameReady` promise so the caller can arm
//   a continuation instead of giving up by the clock.

describe('waitForRedhatServerReady', () => {
    it('returns extension-missing when the resolver yields undefined', async () => {
        const wait = await waitForRedhatServerReady(async () => undefined);
        assert.equal(wait.outcome, 'extension-missing');
    });

    it('returns extension-missing when the resolver yields null', async () => {
        const wait = await waitForRedhatServerReady(async () => null);
        assert.equal(wait.outcome, 'extension-missing');
    });

    it('returns unconfirmed when activation throws', async () => {
        const wait = await waitForRedhatServerReady(async () => {
            throw new Error('activation failed');
        });
        assert.equal(wait.outcome, 'unconfirmed');
    });

    it('returns unconfirmed when the API predates serverReady', async () => {
        const wait = await waitForRedhatServerReady(async () => ({apiVersion: '0.5'}));
        assert.equal(wait.outcome, 'unconfirmed');
    });

    it('returns lightweight without waiting when serverMode is LightWeight', async () => {
        // serverReady would hang forever in this mode; the outcome must come
        // back instantly even with a generous timeout.
        const wait = await waitForRedhatServerReady(
            async () => ({
                serverMode: 'LightWeight',
                serverReady: () => new Promise(() => { /* never settles */ }),
            }),
            60_000,
        );
        assert.equal(wait.outcome, 'lightweight');
    });

    it('returns ready when serverReady resolves', async () => {
        const wait = await waitForRedhatServerReady(async () => ({
            serverReady: () => Promise.resolve(true),
        }));
        assert.equal(wait.outcome, 'ready');
        assert.equal(wait.becameReady, undefined);
    });

    it('waits normally in Hybrid mode (Standard server is starting)', async () => {
        const wait = await waitForRedhatServerReady(async () => ({
            serverMode: 'Hybrid',
            serverReady: () => Promise.resolve(true),
        }));
        assert.equal(wait.outcome, 'ready');
    });

    it('returns unconfirmed when serverReady rejects', async () => {
        const wait = await waitForRedhatServerReady(async () => ({
            serverReady: () => Promise.reject(new Error('server crashed')),
        }));
        assert.equal(wait.outcome, 'unconfirmed');
        assert.equal(wait.becameReady, undefined);
    });

    it('returns timeout with a live becameReady promise when serverReady outlives the budget', async () => {
        let resolveServer: (() => void) | undefined;
        const wait = await waitForRedhatServerReady(
            async () => ({
                serverReady: () => new Promise<void>((resolve) => {
                    resolveServer = resolve;
                }),
            }),
            10,
        );

        assert.equal(wait.outcome, 'timeout');
        assert.ok(wait.becameReady, 'expected the readiness promise to stay available');

        let continued = false;
        void wait.becameReady?.then(() => {
            continued = true;
        });
        assert.equal(continued, false);

        resolveServer?.();
        await wait.becameReady;
        assert.equal(continued, true);
    });

    it('never settles becameReady when the late server fails (continuation must not fire)', async () => {
        let rejectServer: ((reason: Error) => void) | undefined;
        const wait = await waitForRedhatServerReady(
            async () => ({
                serverReady: () => new Promise<void>((_resolve, reject) => {
                    rejectServer = reject;
                }),
            }),
            10,
        );

        assert.equal(wait.outcome, 'timeout');

        let settled = false;
        void wait.becameReady?.then(() => {
            settled = true;
        });
        rejectServer?.(new Error('server died while loading'));
        // Give any (incorrect) settlement a chance to propagate.
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(settled, false);
    });

    it('invokes serverReady with the API object as receiver', async () => {
        // The real extension implements serverReady as a method that reads
        // internal state via `this`; calling it detached would break it.
        let receiverWasApi = false;
        const api = {
            serverReady(this: unknown): Promise<boolean> {
                receiverWasApi = this === api;
                return Promise.resolve(true);
            },
        };

        await waitForRedhatServerReady(async () => api);
        assert.equal(receiverWasApi, true);
    });
});
