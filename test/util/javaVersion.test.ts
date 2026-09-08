import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    isJavaVersionAtLeast,
    TOOLING_JAVA_MIN_VERSION,
    toJavaRuntimeName,
} from '../../src/util/javaVersion';

describe('TOOLING_JAVA_MIN_VERSION', () => {
    it('pins the tooling cutoff at 21 because VS Code Java tooling requires it', () => {
        assert.equal(TOOLING_JAVA_MIN_VERSION, 21);
    });
});

describe('isJavaVersionAtLeast', () => {
    it('returns true when the version equals the threshold', () => {
        assert.equal(isJavaVersionAtLeast('21', 21), true);
    });

    it('returns true when the version exceeds the threshold', () => {
        assert.equal(isJavaVersionAtLeast('25', 21), true);
    });

    it('returns false when the version is below the threshold', () => {
        assert.equal(isJavaVersionAtLeast('17', 21), false);
        assert.equal(isJavaVersionAtLeast('11', 21), false);
        assert.equal(isJavaVersionAtLeast('8', 21), false);
    });

    it('treats non-numeric input as 0 so it never satisfies a positive threshold', () => {
        assert.equal(isJavaVersionAtLeast('abc', 1), false);
        assert.equal(isJavaVersionAtLeast('', 1), false);
    });
});

describe('toJavaRuntimeName', () => {
    it('uses legacy JavaSE-1.X naming for Java 8 and below (Eclipse JDT contract)', () => {
        assert.equal(toJavaRuntimeName('8'), 'JavaSE-1.8');
        assert.equal(toJavaRuntimeName('7'), 'JavaSE-1.7');
        assert.equal(toJavaRuntimeName('6'), 'JavaSE-1.6');
    });

    it('uses modern JavaSE-X naming starting at Java 9', () => {
        assert.equal(toJavaRuntimeName('9'), 'JavaSE-9');
        assert.equal(toJavaRuntimeName('11'), 'JavaSE-11');
        assert.equal(toJavaRuntimeName('17'), 'JavaSE-17');
        assert.equal(toJavaRuntimeName('21'), 'JavaSE-21');
        assert.equal(toJavaRuntimeName('25'), 'JavaSE-25');
    });

    it('passes the raw version through when it cannot be parsed as a number', () => {
        assert.equal(toJavaRuntimeName('lts'), 'JavaSE-lts');
    });
});
