import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_ARCH_NAMES,
    DEFAULT_OS_NAMES,
    determineArchiveType,
    isArchitectureSupported,
    isPlatformSupported,
} from '../../src/core/system';

describe('isPlatformSupported', () => {
    it('accepts windows, linux, and darwin', () => {
        assert.equal(isPlatformSupported('windows'), true);
        assert.equal(isPlatformSupported('linux'), true);
        assert.equal(isPlatformSupported('darwin'), true);
    });

    it('rejects the unknown sentinel value', () => {
        assert.equal(isPlatformSupported('unknown'), false);
    });
});

describe('isArchitectureSupported', () => {
    it('accepts x64 and arm64', () => {
        assert.equal(isArchitectureSupported('x64'), true);
        assert.equal(isArchitectureSupported('arm64'), true);
    });

    it('rejects the unsupported sentinel value', () => {
        assert.equal(isArchitectureSupported('unsupported'), false);
    });
});

describe('determineArchiveType', () => {
    it('returns zip for windows hosts', () => {
        assert.equal(determineArchiveType('windows'), 'zip');
    });

    it('returns tar.gz for every non-windows host', () => {
        assert.equal(determineArchiveType('linux'), 'tar.gz');
        assert.equal(determineArchiveType('darwin'), 'tar.gz');
        assert.equal(determineArchiveType('unknown'), 'tar.gz');
    });
});

describe('DEFAULT_OS_NAMES', () => {
    it('maps darwin to macos for vendors that share the macOS spelling', () => {
        assert.equal(DEFAULT_OS_NAMES.darwin, 'macos');
    });

    it('uses identity mapping for windows and linux', () => {
        assert.equal(DEFAULT_OS_NAMES.windows, 'windows');
        assert.equal(DEFAULT_OS_NAMES.linux, 'linux');
    });

    it('leaves unknown unmapped to surface configuration errors loudly', () => {
        assert.equal(DEFAULT_OS_NAMES.unknown, undefined);
    });
});

describe('DEFAULT_ARCH_NAMES', () => {
    it('maps arm64 to aarch64 for vendor URLs', () => {
        assert.equal(DEFAULT_ARCH_NAMES.arm64, 'aarch64');
    });

    it('keeps x64 as x64', () => {
        assert.equal(DEFAULT_ARCH_NAMES.x64, 'x64');
    });

    it('leaves unsupported unmapped', () => {
        assert.equal(DEFAULT_ARCH_NAMES.unsupported, undefined);
    });
});
