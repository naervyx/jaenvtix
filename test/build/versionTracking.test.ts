import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {
    buildVersionInfoFromDisk,
    getVersionFilePath,
    isNewerVersion,
    readVersionInfo,
    shouldCheckForUpdate,
    touchLastChecked,
    VersionInfo,
    writeVersionInfo,
} from '../../src/build/versionTracking';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSlot(root: string, name: string): string {
    const slot = join(root, name);
    mkdirSync(slot, {recursive: true});
    return slot;
}

describe('versionTracking: read/write', () => {
    let root: string;

    before(async () => { root = await createTempDir('jaenvtix-vt-'); });
    after(async () => { await removeTempDir(root); });

    it('returns null when no version file exists, and a check is then due', () => {
        const slot = makeSlot(root, 'jdk-empty');

        assert.equal(readVersionInfo(slot), null);
        assert.equal(shouldCheckForUpdate(null), true);
    });

    it('round-trips version info through the dotfile', () => {
        const slot = makeSlot(root, 'jdk-roundtrip');
        const info: VersionInfo = {fullVersion: '21.0.5+11', checkedAt: 123, vendor: 'temurin'};

        writeVersionInfo(slot, info);

        assert.deepEqual(readVersionInfo(slot), info);
    });

    it('returns null for a corrupt version file', () => {
        const slot = makeSlot(root, 'jdk-corrupt');
        writeFileSync(getVersionFilePath(slot), '{not json');

        assert.equal(readVersionInfo(slot), null);
    });

    it('touchLastChecked re-stamps checkedAt without altering the version', () => {
        const slot = makeSlot(root, 'jdk-touch');
        const info: VersionInfo = {fullVersion: '17.0.5+8', checkedAt: 0, vendor: 'corretto'};

        touchLastChecked(slot, info, 999);

        assert.deepEqual(readVersionInfo(slot), {...info, checkedAt: 999});
    });
});

describe('shouldCheckForUpdate: 24h rate limit', () => {
    const info = (checkedAt: number): VersionInfo => ({fullVersion: '21.0.5+11', checkedAt, vendor: 'temurin'});

    it('is false within 24 hours of the last check', () => {
        assert.equal(shouldCheckForUpdate(info(1000), 1000 + DAY_MS - 1), false);
    });

    it('is true after 24 hours', () => {
        assert.equal(shouldCheckForUpdate(info(1000), 1000 + DAY_MS + 1), true);
    });
});

describe('isNewerVersion', () => {
    it('detects a newer patch (21.0.5+11 → 21.0.8+9)', () => {
        assert.equal(isNewerVersion('21.0.8+9', '21.0.5+11'), true);
    });

    it('is false for equal versions regardless of format noise', () => {
        assert.equal(isNewerVersion('21.0.5+11', 'jdk-21.0.5+11'), false);
    });

    it('never reports a downgrade as an update', () => {
        assert.equal(isNewerVersion('21.0.5+11', '21.0.8+9'), false);
    });

    it('is false when either side has no numeric content', () => {
        assert.equal(isNewerVersion('latest', '21.0.5'), false);
        assert.equal(isNewerVersion('21.0.8', ''), false);
    });
});

describe('buildVersionInfoFromDisk', () => {
    let root: string;

    before(async () => { root = await createTempDir('jaenvtix-vt-disk-'); });
    after(async () => { await removeTempDir(root); });

    function makeJdkWithRelease(name: string, lines: string[]): string {
        const slot = makeSlot(root, name);
        writeFileSync(join(slot, 'release'), lines.join('\n'));
        return slot;
    }

    it('reads the runtime version and maps the implementor to a vendor', () => {
        const slot = makeJdkWithRelease('jdk-temurin', [
            'IMPLEMENTOR="Eclipse Adoptium"',
            'JAVA_RUNTIME_VERSION="21.0.5+11-LTS"',
            'JAVA_VERSION="21.0.5"',
        ]);

        const info = buildVersionInfoFromDisk(slot, 42);

        assert.deepEqual(info, {fullVersion: '21.0.5+11-LTS', checkedAt: 42, vendor: 'temurin'});
    });

    it('falls back to JAVA_VERSION when JAVA_RUNTIME_VERSION is absent', () => {
        const slot = makeJdkWithRelease('jdk-corretto', [
            'IMPLEMENTOR="Amazon.com Inc."',
            'JAVA_VERSION="17.0.13"',
        ]);

        const info = buildVersionInfoFromDisk(slot, 42);

        assert.equal(info?.fullVersion, '17.0.13');
        assert.equal(info?.vendor, 'corretto');
    });

    it('returns null when the release file is missing', () => {
        const slot = makeSlot(root, 'jdk-no-release');

        assert.equal(buildVersionInfoFromDisk(slot), null);
    });

    it('returns null for an implementor that maps to no known vendor', () => {
        const slot = makeJdkWithRelease('jdk-unknown', [
            'IMPLEMENTOR="ACME JDK Builders"',
            'JAVA_VERSION="21.0.5"',
        ]);

        assert.equal(buildVersionInfoFromDisk(slot), null);
    });

    it('readVersionInfo from a written bootstrap survives a JSON round-trip', () => {
        const slot = makeJdkWithRelease('jdk-oracle', [
            'IMPLEMENTOR="Oracle Corporation"',
            'JAVA_RUNTIME_VERSION="21.0.5+9-LTS-jvmci"',
        ]);

        const info = buildVersionInfoFromDisk(slot, 0);
        assert.ok(info);
        writeVersionInfo(slot, info);

        assert.deepEqual(readVersionInfo(slot), info);
        const raw = readFileSync(getVersionFilePath(slot), 'utf-8');
        assert.match(raw, /"vendor": "oracle"/);
    });
});
