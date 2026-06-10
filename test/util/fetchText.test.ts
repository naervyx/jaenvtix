import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {fetchTextContent} from '../../src/util/fetchText';
import {startTestServer} from '../fixtures/http';

describe('fetchTextContent', () => {
    it('resolves with the response body for a 200 response', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end('<html>maven page</html>');
        });

        try {
            const body = await fetchTextContent(server.url);
            assert.equal(body, '<html>maven page</html>');
        } finally {
            await server.close();
        }
    });

    it('follows a 302 redirect to the final body', async () => {
        const server = await startTestServer((req, res) => {
            if (req.url === '/start') {
                res.writeHead(302, {Location: '/final'});
                res.end();
                return;
            }
            res.writeHead(200);
            res.end('redirected body');
        });

        try {
            const body = await fetchTextContent(`${server.url}/start`);
            assert.equal(body, 'redirected body');
        } finally {
            await server.close();
        }
    });

    it('rejects on a 404 response', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(404);
            res.end('not found');
        });

        try {
            await assert.rejects(fetchTextContent(server.url));
        } finally {
            await server.close();
        }
    });

    it('rejects when the redirect limit is exhausted', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(302, {Location: '/loop'});
            res.end();
        });

        try {
            await assert.rejects(fetchTextContent(server.url, {redirectsLeft: 2}));
        } finally {
            await server.close();
        }
    });

    it('rejects on timeout when the server hangs', async () => {
        const server = await startTestServer(() => {
            // Never respond — force the client-side timeout.
        });

        try {
            await assert.rejects(fetchTextContent(server.url, {timeout: 200}));
        } finally {
            await server.close();
        }
    });

    it('rejects for a malformed URL', async () => {
        await assert.rejects(fetchTextContent('not-a-url'));
    });

    it('rejects on connection refused (no server listening)', async () => {
        await assert.rejects(fetchTextContent('http://127.0.0.1:1/none'));
    });
});
