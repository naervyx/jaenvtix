import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {updateExtensionsJson} from '../../src/build/extensionsJsonWriter';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

async function readJson(filePath: string): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
}

describe('updateExtensionsJson', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function makeTarget(initial?: string): Promise<string> {
        const tempRoot = await createTempDir();
        cleanups.push(() => removeTempDir(tempRoot));
        const extensionsPath = join(tempRoot, '.vscode', 'extensions.json');
        if (initial !== undefined) {
            await fs.mkdir(join(tempRoot, '.vscode'), {recursive: true});
            writeFileSync(extensionsPath, initial, 'utf-8');
        }
        return extensionsPath;
    }

    it('creates .vscode/extensions.json with the recommendations', async () => {
        const extensionsPath = await makeTarget();

        const result = updateExtensionsJson(extensionsPath, ['vscjava.vscode-java-pack', 'redhat.vscode-xml']);

        assert.equal(result.updated, true);
        assert.deepEqual(result.added, ['vscjava.vscode-java-pack', 'redhat.vscode-xml']);
        const data = await readJson(extensionsPath);
        assert.deepEqual(data.recommendations, ['vscjava.vscode-java-pack', 'redhat.vscode-xml']);
    });

    it('preserves existing entries and their order, appending only missing IDs', async () => {
        const extensionsPath = await makeTarget(JSON.stringify({
            recommendations: ['esbenp.prettier-vscode', 'vscjava.vscode-java-pack'],
        }));

        const result = updateExtensionsJson(extensionsPath, ['vscjava.vscode-java-pack', 'redhat.vscode-xml']);

        assert.deepEqual(result.added, ['redhat.vscode-xml']);
        const data = await readJson(extensionsPath);
        assert.deepEqual(data.recommendations, [
            'esbenp.prettier-vscode',
            'vscjava.vscode-java-pack',
            'redhat.vscode-xml',
        ]);
    });

    it('deduplicates case-insensitively (marketplace IDs are case-insensitive)', async () => {
        const extensionsPath = await makeTarget(JSON.stringify({
            recommendations: ['VSCJava.vscode-java-pack'],
        }));

        const result = updateExtensionsJson(extensionsPath, ['vscjava.vscode-java-pack']);

        assert.equal(result.updated, false);
        const data = await readJson(extensionsPath);
        assert.deepEqual(data.recommendations, ['VSCJava.vscode-java-pack']);
    });

    it('preserves unrelated keys such as unwantedRecommendations', async () => {
        const extensionsPath = await makeTarget(JSON.stringify({
            recommendations: [],
            unwantedRecommendations: ['some.extension'],
        }));

        updateExtensionsJson(extensionsPath, ['redhat.vscode-xml']);

        const data = await readJson(extensionsPath);
        assert.deepEqual(data.unwantedRecommendations, ['some.extension']);
        assert.deepEqual(data.recommendations, ['redhat.vscode-xml']);
    });

    it('is idempotent: a second run with the same IDs is a no-op', async () => {
        const extensionsPath = await makeTarget();

        updateExtensionsJson(extensionsPath, ['redhat.vscode-xml']);
        const second = updateExtensionsJson(extensionsPath, ['redhat.vscode-xml']);

        assert.equal(second.updated, false);
        assert.deepEqual(second.added, []);
    });

    it('recovers from a malformed file by rebuilding the recommendations', async () => {
        const extensionsPath = await makeTarget('{broken json');

        const result = updateExtensionsJson(extensionsPath, ['redhat.vscode-xml']);

        assert.equal(result.updated, true);
        const data = await readJson(extensionsPath);
        assert.deepEqual(data.recommendations, ['redhat.vscode-xml']);
    });

    it('ignores non-string garbage inside an existing recommendations array', async () => {
        const extensionsPath = await makeTarget(JSON.stringify({
            recommendations: ['valid.extension', 42, null],
        }));

        updateExtensionsJson(extensionsPath, ['redhat.vscode-xml']);

        const data = await readJson(extensionsPath);
        assert.deepEqual(data.recommendations, ['valid.extension', 'redhat.vscode-xml']);
    });
});
