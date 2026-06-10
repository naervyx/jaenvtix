import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    FALLBACK_SUPPORTED_JAVA_VERSIONS,
    isLtsVersion,
    parseSupportedJavaVersions,
    readSupportedJavaVersions,
} from '../../src/build/redhatRuntimeReader';

function redhatPackageJson(enumNames: unknown): unknown {
    return {
        contributes: {
            configuration: {
                properties: {
                    'java.configuration.runtimes': {
                        items: {properties: {name: {enum: enumNames}}},
                    },
                },
            },
        },
    };
}

const REDHAT_ENUM = ['J2SE-1.5', 'JavaSE-1.6', 'JavaSE-1.7', 'JavaSE-1.8', 'JavaSE-11', 'JavaSE-17', 'JavaSE-21', 'JavaSE-25'];

describe('readSupportedJavaVersions', () => {
    it('parses the redhat.java enum into sorted majors and LTS metadata', () => {
        const result = readSupportedJavaVersions(() => redhatPackageJson(REDHAT_ENUM));

        assert.deepEqual(result.majors, [5, 6, 7, 8, 11, 17, 21, 25]);
        assert.deepEqual(result.ltsList, [8, 11, 17, 21, 25]);
        assert.equal(result.latestLts, 25);
        assert.equal(result.latestAvailable, 25);
        assert.deepEqual(result.names, REDHAT_ENUM);
    });

    it('recognizes a future Java release the day Red Hat publishes it', () => {
        const result = readSupportedJavaVersions(() => redhatPackageJson([...REDHAT_ENUM, 'JavaSE-29']));

        assert.equal(result.latestLts, 29);
        assert.ok(result.majors.includes(29));
    });

    it('falls back to the static list when redhat.java is not installed', () => {
        assert.deepEqual(readSupportedJavaVersions(() => undefined), FALLBACK_SUPPORTED_JAVA_VERSIONS);
        assert.deepEqual(readSupportedJavaVersions(), FALLBACK_SUPPORTED_JAVA_VERSIONS);
    });

    it('falls back when the configuration schema changed shape (no enum)', () => {
        const noEnum = redhatPackageJson(undefined);
        assert.deepEqual(readSupportedJavaVersions(() => noEnum), FALLBACK_SUPPORTED_JAVA_VERSIONS);
        assert.deepEqual(
            readSupportedJavaVersions(() => ({contributes: {}})),
            FALLBACK_SUPPORTED_JAVA_VERSIONS,
        );
    });

    it('falls back when reading the extension throws', () => {
        const result = readSupportedJavaVersions(() => { throw new Error('host gone'); });

        assert.deepEqual(result, FALLBACK_SUPPORTED_JAVA_VERSIONS);
    });
});

describe('parseSupportedJavaVersions', () => {
    it('parses legacy and modern name forms (J2SE-1.5 → 5, JavaSE-1.8 → 8, JavaSE-21 → 21)', () => {
        const result = parseSupportedJavaVersions(['J2SE-1.5', 'JavaSE-1.8', 'JavaSE-21']);

        assert.deepEqual(result?.majors, [5, 8, 21]);
    });

    it('ignores unparseable names and returns null when nothing parses', () => {
        assert.deepEqual(parseSupportedJavaVersions(['JavaSE-21', 'garbage'])?.majors, [21]);
        assert.equal(parseSupportedJavaVersions(['garbage']), null);
        assert.equal(parseSupportedJavaVersions([]), null);
        assert.equal(parseSupportedJavaVersions('not-an-array'), null);
    });
});

describe('isLtsVersion', () => {
    it('matches the OpenJDK LTS cadence', () => {
        for (const lts of [8, 11, 17, 21, 25, 29]) {
            assert.equal(isLtsVersion(lts), true, `expected ${lts} to be LTS`);
        }
        for (const nonLts of [7, 9, 10, 12, 16, 18, 22, 26]) {
            assert.equal(isLtsVersion(nonLts), false, `expected ${nonLts} to not be LTS`);
        }
    });
});
