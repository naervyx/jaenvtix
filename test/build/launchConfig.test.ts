import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {updateVsCodeLaunchConfig} from '../../src/build/launchConfig';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

interface LaunchFile {
    version?: string;
    configurations?: Record<string, unknown>[];
    [key: string]: unknown;
}

async function withLaunchFile(initial?: LaunchFile): Promise<{launchPath: string; cleanup: () => Promise<void>}> {
    const tempRoot = await createTempDir();
    const launchPath = join(tempRoot, '.vscode', 'launch.json');
    if (initial) {
        await fs.mkdir(join(tempRoot, '.vscode'), {recursive: true});
        writeFileSync(launchPath, JSON.stringify(initial), 'utf-8');
    }
    return {launchPath, cleanup: () => removeTempDir(tempRoot)};
}

async function readLaunch(launchPath: string): Promise<LaunchFile> {
    const content = await fs.readFile(launchPath, 'utf-8');
    return JSON.parse(content) as LaunchFile;
}

describe('updateVsCodeLaunchConfig', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('creates launch.json with version 0.2.0 and the desired configuration on a clean project', async () => {
        const {launchPath, cleanup} = await withLaunchFile();
        cleanups.push(cleanup);

        const result = updateVsCodeLaunchConfig(launchPath, [{
            type: 'java',
            request: 'launch',
            name: 'Spring Boot — demo',
            mainClass: 'com.example.DemoApplication',
            projectName: 'demo',
        }]);

        assert.equal(result.updated, true);
        assert.deepEqual(result.updatedNames, ['Spring Boot — demo']);

        const launch = await readLaunch(launchPath);
        assert.equal(launch.version, '0.2.0');
        assert.equal(launch.configurations?.length, 1);
        assert.equal(launch.configurations?.[0].mainClass, 'com.example.DemoApplication');
    });

    it('appends a new configuration without touching existing ones with different names', async () => {
        const {launchPath, cleanup} = await withLaunchFile({
            version: '0.2.0',
            configurations: [{type: 'node', request: 'launch', name: 'Node frontend'}],
        });
        cleanups.push(cleanup);

        updateVsCodeLaunchConfig(launchPath, [{
            type: 'java',
            request: 'launch',
            name: 'Java backend',
            mainClass: 'com.example.Main',
        }]);

        const launch = await readLaunch(launchPath);
        assert.equal(launch.configurations?.length, 2);
        const names = launch.configurations?.map((c) => c.name);
        assert.deepEqual(names, ['Node frontend', 'Java backend']);
    });

    it('merges into an existing configuration of the same name when fields change', async () => {
        const {launchPath, cleanup} = await withLaunchFile({
            version: '0.2.0',
            configurations: [{
                type: 'java',
                request: 'launch',
                name: 'Java backend',
                mainClass: 'com.old.Main',
                preserveMe: 'should-stay',
            }],
        });
        cleanups.push(cleanup);

        const result = updateVsCodeLaunchConfig(launchPath, [{
            type: 'java',
            request: 'launch',
            name: 'Java backend',
            mainClass: 'com.new.Main',
        }]);

        assert.equal(result.updated, true);
        assert.deepEqual(result.updatedNames, ['Java backend']);

        const launch = await readLaunch(launchPath);
        assert.equal(launch.configurations?.[0].mainClass, 'com.new.Main');
        assert.equal(launch.configurations?.[0].preserveMe, 'should-stay');
    });

    it('reports updated=false on a no-op second pass', async () => {
        const {launchPath, cleanup} = await withLaunchFile();
        cleanups.push(cleanup);

        const desired = [{type: 'java', request: 'launch', name: 'Java backend', mainClass: 'com.example.Main'}];
        updateVsCodeLaunchConfig(launchPath, desired);
        const second = updateVsCodeLaunchConfig(launchPath, desired);
        assert.equal(second.updated, false);
        assert.deepEqual(second.updatedNames, []);
    });

    it('upgrades version to 0.2.0 when the existing file uses something else', async () => {
        const {launchPath, cleanup} = await withLaunchFile({version: '0.1.0', configurations: []});
        cleanups.push(cleanup);

        updateVsCodeLaunchConfig(launchPath, []);
        const launch = await readLaunch(launchPath);
        assert.equal(launch.version, '0.2.0');
    });

    it('rewrites cleanly when the existing launch.json is malformed JSON', async () => {
        const {launchPath, cleanup} = await withLaunchFile();
        cleanups.push(cleanup);
        await fs.mkdir(join(launchPath, '..'), {recursive: true});
        writeFileSync(launchPath, '{malformed', 'utf-8');

        const result = updateVsCodeLaunchConfig(launchPath, [
            {type: 'java', request: 'launch', name: 'Java backend', mainClass: 'com.example.Main'},
        ]);

        assert.equal(result.updated, true);
        const launch = await readLaunch(launchPath);
        assert.equal(launch.configurations?.[0].name, 'Java backend');
    });

    it('REGRESSION (B4): invokes onMalformed once when the existing launch.json is unparseable', async () => {
        const {launchPath, cleanup} = await withLaunchFile();
        cleanups.push(cleanup);
        await fs.mkdir(join(launchPath, '..'), {recursive: true});
        writeFileSync(launchPath, '{still-malformed', 'utf-8');

        const calls: string[] = [];
        const result = updateVsCodeLaunchConfig(
            launchPath,
            [{type: 'java', request: 'launch', name: 'Java backend', mainClass: 'com.example.Main'}],
            {onMalformed: (filePath) => calls.push(filePath)},
        );

        assert.equal(result.updated, true);
        assert.deepEqual(calls, [launchPath]);
    });

    it('REGRESSION (B4): does NOT invoke onMalformed when the existing launch.json parses cleanly', async () => {
        const {launchPath, cleanup} = await withLaunchFile({version: '0.2.0', configurations: []});
        cleanups.push(cleanup);

        let invoked = false;
        updateVsCodeLaunchConfig(
            launchPath,
            [{type: 'java', request: 'launch', name: 'Java backend', mainClass: 'com.example.Main'}],
            {onMalformed: () => {invoked = true;}},
        );

        assert.equal(invoked, false);
    });
});
