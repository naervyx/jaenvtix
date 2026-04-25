import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {join} from 'node:path';

import {downloadFile} from '../../src/file/fileDownload';
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
        });

        assert.equal(result.success, false);
        assert.match(result.error ?? '', /500/);
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
