import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {ValidateEnvironmentStep} from '../../../src/configuration/steps/validateEnvironmentStep';
import type {MavenDistribution} from '../../../src/build/mavenUrl';
import {createInitialState} from '../../../src/core/types';

const goodMaven: MavenDistribution = {
    name: 'maven-3.9.6', url: 'https://example.org/maven-3.9.6.tar.gz', extension: 'tar.gz', version: '3.9.6',
};

describe('ValidateEnvironmentStep', () => {
    it('warns and bails when no workspace folders are open', async () => {
        const step = new ValidateEnvironmentStep(undefined);
        const result = await step.run(createInitialState());
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /workspace/i);
    });

    it('warns when the architecture is not supported', async () => {
        const step = new ValidateEnvironmentStep(
            [{uri: {fsPath: '/ws'}}],
            {getArchitecture: () => 'mips' as never},
        );
        const result = await step.run(createInitialState());
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /architecture/i);
    });

    it('warns when the platform is not supported', async () => {
        const step = new ValidateEnvironmentStep(
            [{uri: {fsPath: '/ws'}}],
            {
                getArchitecture: () => 'x64',
                getPlatform: () => 'aix' as never,
            },
        );
        const result = await step.run(createInitialState());
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /platform/i);
    });

    it('warns when the Maven distribution lookup returns null', async () => {
        const step = new ValidateEnvironmentStep(
            [{uri: {fsPath: '/ws'}}],
            {
                getArchitecture: () => 'x64',
                getPlatform: () => 'linux',
                getMavenDistribution: async () => null,
            },
        );
        const result = await step.run(createInitialState());
        assert.equal(result.kind, 'warning');
        assert.match(result.message ?? '', /maven/i);
    });

    it('populates state.platform/arch/mavenDistribution and the workspace fsPaths on success', async () => {
        const state = createInitialState();
        const step = new ValidateEnvironmentStep(
            [{uri: {fsPath: '/ws/a'}}, {uri: {fsPath: '/ws/b'}}],
            {
                getArchitecture: () => 'arm64',
                getPlatform: () => 'darwin',
                getMavenDistribution: async () => goodMaven,
            },
        );

        const result = await step.run(state);

        assert.equal(result.success, true);
        assert.equal(state.platform, 'darwin');
        assert.equal(state.arch, 'arm64');
        assert.equal(state.mavenDistribution, goodMaven);
        assert.deepEqual(state.workspaceFolders, ['/ws/a', '/ws/b']);
    });
});
