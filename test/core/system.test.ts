import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_ARCH_NAMES,
    DEFAULT_OS_NAMES,
    determineArchiveType,
    getPlatform,
    isArchitectureSupported,
    isMusl,
    isPlatformSupported,
    SUPPORTED_PLATFORMS,
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

describe('isMusl', () => {
    it('detects the musl x64 dynamic linker', () => {
        assert.equal(isMusl('linux', (p) => p === '/lib/ld-musl-x86_64.so.1'), true);
    });

    it('detects the musl aarch64 dynamic linker', () => {
        assert.equal(isMusl('linux', (p) => p === '/lib/ld-musl-aarch64.so.1'), true);
    });

    it('falls back to /etc/alpine-release when no linker is visible', () => {
        assert.equal(isMusl('linux', (p) => p === '/etc/alpine-release'), true);
    });

    it('reports glibc Linux as non-musl', () => {
        assert.equal(isMusl('linux', () => false), false);
    });

    it('short-circuits to false off Linux without probing the filesystem', () => {
        let probed = false;
        assert.equal(isMusl('win32', () => { probed = true; return true; }), false);
        assert.equal(probed, false);
    });
});

describe('getPlatform: musl split', () => {
    it('maps musl Linux to linux-musl', () => {
        assert.equal(getPlatform('linux', () => true), 'linux-musl');
    });

    it('maps glibc Linux to linux', () => {
        assert.equal(getPlatform('linux', () => false), 'linux');
    });

    it('keeps windows/darwin mappings untouched', () => {
        assert.equal(getPlatform('win32'), 'windows');
        assert.equal(getPlatform('darwin'), 'darwin');
    });

    it('linux-musl is a supported platform', () => {
        assert.equal(SUPPORTED_PLATFORMS.has('linux-musl'), true);
    });
});
