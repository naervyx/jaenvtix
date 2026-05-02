import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {DetectedJdk, selectBestJdkForVersion} from '../../src/build/jdkDetection';

// Business rules:
// - Jaenvtix only reuses an installed runtime when it is a real JDK
//   (`hasJavac=true`). A JRE cannot compile, so it is useless to us.
// - The major version must match exactly. We never substitute another major.
// - When several JDKs satisfy the version, the one the user clearly intends
//   (JDK_HOME > JAVA_HOME > PATH) wins, with managed installs (SDKMAN, jEnv,
//   jabba, asdf, gradle, jbang) as the next preference. This avoids picking
//   an obscure scan result over the JDK the user actually configured.

function jdk(overrides: Partial<DetectedJdk>): DetectedJdk {
    return {
        homedir: '/jdk',
        version: {major: 17},
        hasJavac: true,
        ...overrides,
    };
}

describe('selectBestJdkForVersion', () => {
    it('returns null when no candidate matches the requested major', () => {
        const result = selectBestJdkForVersion(
            [jdk({version: {major: 11}}), jdk({version: {major: 21}})],
            17,
        );
        assert.equal(result, null);
    });

    it('ignores JREs (hasJavac is not true)', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/jre-only', hasJavac: false}),
                jdk({homedir: '/jre-undef', hasJavac: undefined}),
            ],
            17,
        );
        assert.equal(result, null);
    });

    it('picks the JDK_HOME-backed runtime ahead of every other source', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/sdkman', isFromSDKMAN: true}),
                jdk({homedir: '/path', isInPathEnv: true}),
                jdk({homedir: '/java-home', isJavaHomeEnv: true}),
                jdk({homedir: '/jdk-home', isJdkHomeEnv: true}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/jdk-home');
    });

    it('falls back to JAVA_HOME when JDK_HOME is absent', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/sdkman', isFromSDKMAN: true}),
                jdk({homedir: '/path', isInPathEnv: true}),
                jdk({homedir: '/java-home', isJavaHomeEnv: true}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/java-home');
    });

    it('falls back to PATH when neither JDK_HOME nor JAVA_HOME is present', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/sdkman', isFromSDKMAN: true}),
                jdk({homedir: '/path', isInPathEnv: true}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/path');
    });

    it('falls back to a managed install (SDKMAN/jEnv/jabba/asdf/gradle/jbang) before unrecognised sources', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/scanned'}),  // No env/source flags at all
                jdk({homedir: '/sdkman', isFromSDKMAN: true}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/sdkman');
    });

    it('returns the first matching candidate when no preference flag distinguishes them', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/first'}),
                jdk({homedir: '/second'}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/first');
    });

    it('matches major exactly even when the same machine has higher majors installed', () => {
        const result = selectBestJdkForVersion(
            [
                jdk({homedir: '/jdk-21', version: {major: 21}, isJdkHomeEnv: true}),
                jdk({homedir: '/jdk-17', version: {major: 17}, isInPathEnv: true}),
            ],
            17,
        );
        assert.equal(result?.homedir, '/jdk-17');
    });
});
