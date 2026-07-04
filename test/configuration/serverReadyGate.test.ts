import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {waitForRedhatServerReady} from '../../src/configuration/serverReadyGate';

// Business rules:
// - Extension absent → 'extension-missing' (callers skip Language Server work).
// - Everything short of a confirmed ready signal (activation failure, old API
//   without serverReady, rejection, timeout) → 'unconfirmed' so callers
//   proceed best-effort, exactly as Jaenvtix behaved before the gate existed.
// - serverReady resolving in time → 'ready'.

describe('waitForRedhatServerReady', () => {
    it('returns extension-missing when the resolver yields undefined', async () => {
        const outcome = await waitForRedhatServerReady(async () => undefined);
        assert.equal(outcome, 'extension-missing');
    });

    it('returns extension-missing when the resolver yields null', async () => {
        const outcome = await waitForRedhatServerReady(async () => null);
        assert.equal(outcome, 'extension-missing');
    });

    it('returns unconfirmed when activation throws', async () => {
        const outcome = await waitForRedhatServerReady(async () => {
            throw new Error('activation failed');
        });
        assert.equal(outcome, 'unconfirmed');
    });

    it('returns unconfirmed when the API predates serverReady', async () => {
        const outcome = await waitForRedhatServerReady(async () => ({apiVersion: '0.5'}));
        assert.equal(outcome, 'unconfirmed');
    });

    it('returns ready when serverReady resolves', async () => {
        const outcome = await waitForRedhatServerReady(async () => ({
            serverReady: () => Promise.resolve(true),
        }));
        assert.equal(outcome, 'ready');
    });

    it('returns unconfirmed when serverReady rejects', async () => {
        const outcome = await waitForRedhatServerReady(async () => ({
            serverReady: () => Promise.reject(new Error('server crashed')),
        }));
        assert.equal(outcome, 'unconfirmed');
    });

    it('returns unconfirmed when serverReady never settles within the timeout', async () => {
        const outcome = await waitForRedhatServerReady(
            async () => ({
                serverReady: () => new Promise(() => { /* never settles */ }),
            }),
            10,
        );
        assert.equal(outcome, 'unconfirmed');
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
