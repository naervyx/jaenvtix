import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {isUrlAccessible} from '../../src/util/urlValidator';
import {startTestServer, type TestServer} from '../fixtures/http';

describe('isUrlAccessible', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    function track(server: TestServer): void {
        cleanups.push(() => server.close());
    }

    it('returns true for a 200 HEAD response', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(200);
            res.end();
        });
        track(server);

        assert.equal(await isUrlAccessible(server.url), true);
    });

    it('returns true for a 301/302 redirect (HEAD does not auto-follow but counts as accessible)', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(301, {location: '/elsewhere'});
            res.end();
        });
        track(server);

        // 301 is in the 2xx-3xx range; the validator counts it as accessible.
        assert.equal(await isUrlAccessible(server.url), true);
    });

    it('returns false for a 404 HEAD response', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(404);
            res.end();
        });
        track(server);

        assert.equal(await isUrlAccessible(server.url), false);
    });

    it('returns false for a 500 HEAD response', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(500);
            res.end();
        });
        track(server);

        assert.equal(await isUrlAccessible(server.url), false);
    });

    it('returns false on connection refused (no server listening)', async () => {
        // 127.0.0.1:1 is reserved (TCPMUX) and almost never bound.
        assert.equal(await isUrlAccessible('http://127.0.0.1:1/'), false);
    });

    it('returns false for a malformed URL', async () => {
        assert.equal(await isUrlAccessible('::not-a-url::'), false);
    });

    it('honours the custom timeout when the server hangs', async () => {
        const server = await startTestServer(() => {
            // Never call res.end — leave the request hanging.
        });
        track(server);

        const start = Date.now();
        const result = await isUrlAccessible(server.url, 200);
        const elapsed = Date.now() - start;

        assert.equal(result, false);
        assert.ok(elapsed < 1500, `expected to time out under ~200ms+slack, took ${elapsed}ms`);
    });
});
