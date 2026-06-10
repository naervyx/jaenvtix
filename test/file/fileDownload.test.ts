import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {
    computeBackoffMs,
    downloadFile,
    DownloadResult,
    isTransientDownloadFailure,
} from '../../src/file/fileDownload';
import {startTestServer, type TestServer} from '../fixtures/http';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

describe('downloadFile', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('downloads a 200 response into the target dir', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(200, {'content-type': 'application/octet-stream'});
            res.end('hello-world');
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/file.txt',
            fileName: 'file',
            extension: 'txt',
            targetDir: tempRoot,
        });

        assert.equal(result.success, true);
        assert.equal(result.filePath, join(tempRoot, 'file.txt'));
        const written = await fs.readFile(result.filePath, 'utf-8');
        assert.equal(written, 'hello-world');
    });

    it('follows a 302 redirect to a 200 endpoint', async () => {
        let redirectTarget = '';
        const server = await startTestServer((req, res) => {
            if (req.url === '/start') {
                res.writeHead(302, {location: redirectTarget});
                res.end();
                return;
            }
            res.writeHead(200);
            res.end('redirected-payload');
        });
        redirectTarget = server.url + '/final';
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/start',
            fileName: 'redir',
            extension: 'bin',
            targetDir: tempRoot,
        });

        assert.equal(result.success, true);
        const written = await fs.readFile(result.filePath, 'utf-8');
        assert.equal(written, 'redirected-payload');
    });

    it('REGRESSION (B1): a 302 -> 500 chain surfaces failure instead of hanging', async () => {
        const server = await startTestServer((req, res) => {
            if (req.url === '/start') {
                res.writeHead(302, {location: '/dead'});
                res.end();
                return;
            }
            res.writeHead(500);
            res.end('boom');
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/start',
            fileName: 'redir-fail',
            extension: 'bin',
            targetDir: tempRoot,
            timeout: 2000,
            // This regression test is about redirect-chain failure surfacing,
            // not the retry layer — keep it on the fail-fast path.
            maxRetries: 0,
        });

        assert.equal(result.success, false);
        assert.match(result.error ?? '', /500/);
    });

    // MP-05: retry with exponential backoff for transient failures.

    it('retries a 503 and succeeds on the next attempt', async () => {
        let hits = 0;
        const server = await startTestServer((_req, res) => {
            hits += 1;
            if (hits === 1) {
                res.writeHead(503);
                res.end();
                return;
            }
            res.writeHead(200);
            res.end('eventually-fine');
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/flaky',
            fileName: 'flaky',
            extension: 'bin',
            targetDir: tempRoot,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, true);
        assert.equal(hits, 2);
        assert.equal(await fs.readFile(result.filePath, 'utf-8'), 'eventually-fine');
    });

    it('retries a connection reset and succeeds on the next attempt', async () => {
        let hits = 0;
        const server = await startTestServer((req, res) => {
            hits += 1;
            if (hits === 1) {
                req.socket.destroy();
                return;
            }
            res.writeHead(200);
            res.end('after-reset');
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/reset',
            fileName: 'reset',
            extension: 'bin',
            targetDir: tempRoot,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, true);
        assert.equal(hits, 2);
    });

    it('retries a 429 (rate limit) and succeeds on the next attempt', async () => {
        let hits = 0;
        const server = await startTestServer((_req, res) => {
            hits += 1;
            res.writeHead(hits === 1 ? 429 : 200);
            res.end(hits === 1 ? '' : 'ok');
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/limited',
            fileName: 'limited',
            extension: 'bin',
            targetDir: tempRoot,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, true);
        assert.equal(hits, 2);
    });

    it('gives up after maxRetries exhausted, reporting the last failure', async () => {
        let hits = 0;
        const server = await startTestServer((_req, res) => {
            hits += 1;
            res.writeHead(503);
            res.end();
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/down',
            fileName: 'down',
            extension: 'bin',
            targetDir: tempRoot,
            maxRetries: 3,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, false);
        assert.equal(result.statusCode, 503);
        assert.equal(hits, 4, '1 initial attempt + 3 retries');
    });

    it('does NOT retry a 404 (permanent failure)', async () => {
        let hits = 0;
        const server = await startTestServer((_req, res) => {
            hits += 1;
            res.writeHead(404);
            res.end();
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/nope',
            fileName: 'nope',
            extension: 'bin',
            targetDir: tempRoot,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, false);
        assert.equal(hits, 1);
    });

    it('does NOT retry a refused connection', async () => {
        const server = await startTestServer((_req, res) => { res.end(); });
        const refusedUrl = server.url + '/refused';
        await server.close();
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));

        const result = await downloadFile({
            url: refusedUrl,
            fileName: 'refused',
            extension: 'bin',
            targetDir: tempRoot,
            baseBackoffMs: 1,
        });

        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'ECONNREFUSED');
    });

    it('maxRetries: 0 keeps the historic fail-fast behaviour for a 503', async () => {
        let hits = 0;
        const server = await startTestServer((_req, res) => {
            hits += 1;
            res.writeHead(503);
            res.end();
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/failfast',
            fileName: 'failfast',
            extension: 'bin',
            targetDir: tempRoot,
            maxRetries: 0,
        });

        assert.equal(result.success, false);
        assert.equal(hits, 1);
    });

    it('computes exponential backoff delays (1s, 2s, 4s)', () => {
        assert.equal(computeBackoffMs(1000, 0), 1000);
        assert.equal(computeBackoffMs(1000, 1), 2000);
        assert.equal(computeBackoffMs(1000, 2), 4000);
    });

    it('classifies failures per the retry table', () => {
        const failure = (extra: Partial<DownloadResult>): DownloadResult =>
            ({success: false, filePath: '/x', ...extra});

        assert.equal(isTransientDownloadFailure(failure({errorCode: 'ETIMEDOUT'})), true);
        assert.equal(isTransientDownloadFailure(failure({errorCode: 'ECONNRESET'})), true);
        assert.equal(isTransientDownloadFailure(failure({statusCode: 500})), true);
        assert.equal(isTransientDownloadFailure(failure({statusCode: 429})), true);
        assert.equal(isTransientDownloadFailure(failure({errorCode: 'ECONNREFUSED'})), false);
        assert.equal(isTransientDownloadFailure(failure({errorCode: 'ENOTFOUND'})), false);
        assert.equal(isTransientDownloadFailure(failure({statusCode: 404})), false);
        assert.equal(isTransientDownloadFailure(failure({})), false);
        assert.equal(isTransientDownloadFailure({success: true, filePath: '/x'}), false);
    });

    it('reports failure on 404 without writing the file', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(404);
            res.end();
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/missing',
            fileName: 'missing',
            extension: 'bin',
            targetDir: tempRoot,
        });

        assert.equal(result.success, false);
        assert.match(result.error ?? '', /404/);
        assert.equal(existsSync(result.filePath), false);
    });

    it('caps redirect chains via redirectsLeft', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(302, {location: '/loop'});
            res.end();
        });
        const tempRoot = await createTempDir();
        registerCleanup(server, tempRoot);

        const result = await downloadFile({
            url: server.url + '/loop',
            fileName: 'loop',
            extension: 'bin',
            targetDir: tempRoot,
            redirectsLeft: 2,
        });

        assert.equal(result.success, false);
        assert.match(result.error ?? '', /redirect/i);
    });

    it('REGRESSION (B5): creates the destination directory if it does not exist', async () => {
        const server = await startTestServer((_req, res) => {
            res.writeHead(200);
            res.end('payload');
        });
        const tempRoot = await createTempDir();
        const nestedDir = join(tempRoot, 'a', 'b', 'c');
        cleanups.push(() => server.close(), () => removeTempDir(tempRoot));

        const result = await downloadFile({
            url: server.url + '/x',
            fileName: 'nested',
            extension: 'bin',
            targetDir: nestedDir,
        });

        assert.equal(result.success, true);
        assert.equal(existsSync(join(nestedDir, 'nested.bin')), true);
    });

    function registerCleanup(server: TestServer, tempRoot: string): void {
        cleanups.push(() => server.close(), () => removeTempDir(tempRoot));
    }
});
