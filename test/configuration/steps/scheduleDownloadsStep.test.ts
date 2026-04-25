import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ScheduleDownloadsStep} from '../../../src/configuration/steps/scheduleDownloadsStep';
import {createInitialState} from '../../../src/core/types';
import type {DownloadOptions, DownloadResult} from '../../../src/file/fileDownload';
import type {JdkDistribution} from '../../../src/build/javaUrl';
import type {MavenDistribution} from '../../../src/build/mavenUrl';
import {createTempDir, removeTempDir} from '../../fixtures/tempDir';

const maven: MavenDistribution = {
    name: 'maven-3.9.6', url: 'https://x/m.tar.gz', extension: 'tar.gz', version: '3.9.6',
};

function jdk(version: string): JdkDistribution {
    return {name: `jdk-${version}`, url: `https://x/jdk-${version}.tar.gz`, extension: 'tar.gz'};
}

describe('ScheduleDownloadsStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    it('errors when platform / arch / mavenDistribution are missing', async () => {
        const state = createInitialState();
        const result = await new ScheduleDownloadsStep().run(state);
        assert.equal(result.kind, 'error');
    });

    it('warns when getJdkDistribution returns null for a missing JDK', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.mavenDistribution = maven;
        // Use a path we know does NOT exist as a JDK home.
        state.versionPaths.set('17', {
            jdkHome: '/nonexistent/jdk-17',
            toolHome: '/nonexistent/jdk-17/mvn-custom',
            toolBin: '/nonexistent/jdk-17/mvn-custom/bin',
        });

        const step = new ScheduleDownloadsStep({
            getJdkDistribution: async () => null,
            downloadFile: async () => ({success: true, filePath: '/x'}),
        });

        const result = await step.run(state);
        assert.equal(result.kind, 'warning');
    });

    it('schedules a JDK download when the jdkHome is missing and dispatches it via downloadFile', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.mavenDistribution = maven;
        state.versionPaths.set('17', {
            jdkHome: '/nonexistent/jdk-17',
            toolHome: '/nonexistent/jdk-17/mvn-custom',
            toolBin: '/nonexistent/jdk-17/mvn-custom/bin',
        });

        const calls: DownloadOptions[] = [];
        const step = new ScheduleDownloadsStep({
            getJdkDistribution: async (version) => jdk(version),
            downloadFile: async (opts) => {
                calls.push(opts);
                return {success: true, filePath: `/tmp/${opts.fileName}.${opts.extension}`};
            },
        });

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(state.jdkDownloads.has('17'), true);
        // 1 jdk + 1 maven (since toolBin is also missing)
        assert.equal(calls.length, 2);
        const jdkCall = calls.find((c) => c.fileName === 'jdk-17');
        const mvnCall = calls.find((c) => c.fileName === 'maven-3.9.6');
        assert.ok(jdkCall);
        assert.ok(mvnCall);
    });

    it('does NOT schedule a JDK download when jdkHome already has a working installation', async () => {
        // Build a real fake JDK layout under temp so hasJdkInstallation returns true.
        const root = await createTempDir();
        cleanups.push(() => removeTempDir(root));
        const jdkHome = join(root, 'jdk-17');
        const toolHome = join(jdkHome, 'mvn-custom');
        const toolBin = join(toolHome, 'bin');
        await fs.mkdir(join(jdkHome, 'bin'), {recursive: true});
        await fs.writeFile(join(jdkHome, 'bin', 'java'), '');
        await fs.mkdir(toolBin, {recursive: true});
        await fs.writeFile(join(toolBin, 'mvn'), '');

        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.mavenDistribution = maven;
        state.versionPaths.set('17', {jdkHome, toolHome, toolBin});

        const calls: DownloadOptions[] = [];
        const step = new ScheduleDownloadsStep({
            getJdkDistribution: async (version) => jdk(version),
            downloadFile: async (opts) => {
                calls.push(opts);
                return {success: true, filePath: '/x'};
            },
        });

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(state.jdkDownloads.has('17'), false);
        assert.equal(calls.length, 0, 'no downloads should be scheduled when both JDK and Maven are installed');
        assert.equal(state.mavenDownload, undefined);
    });

    it('does NOT re-schedule a JDK download already present in jdkDownloads', async () => {
        const state = createInitialState();
        state.platform = 'linux';
        state.arch = 'x64';
        state.mavenDistribution = maven;
        state.versionPaths.set('17', {
            jdkHome: '/nonexistent/jdk-17',
            toolHome: '/nonexistent/jdk-17/mvn-custom',
            toolBin: '/nonexistent/jdk-17/mvn-custom/bin',
        });
        const existing: Promise<DownloadResult> = Promise.resolve({success: true, filePath: '/already'});
        state.jdkDownloads.set('17', existing);

        const calls: DownloadOptions[] = [];
        const step = new ScheduleDownloadsStep({
            getJdkDistribution: async (version) => jdk(version),
            downloadFile: async (opts) => {calls.push(opts); return {success: true, filePath: '/x'};},
        });

        await step.run(state);

        // Only Maven gets scheduled (no double-jdk).
        assert.equal(state.jdkDownloads.get('17'), existing);
        assert.equal(calls.filter((c) => c.fileName.startsWith('jdk-')).length, 0);
    });
});
