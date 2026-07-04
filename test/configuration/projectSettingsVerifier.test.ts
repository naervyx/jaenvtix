import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    COMPILER_COMPLIANCE_KEY,
    parseJdtComplianceMajor,
    verifyProjectCompliance,
} from '../../src/configuration/projectSettingsVerifier';

describe('parseJdtComplianceMajor', () => {
    it('parses the legacy 1.x form used up to Java 8', () => {
        assert.equal(parseJdtComplianceMajor('1.8'), 8);
        assert.equal(parseJdtComplianceMajor('1.7'), 7);
    });

    it('parses the plain major form used from Java 9 on', () => {
        assert.equal(parseJdtComplianceMajor('17'), 17);
        assert.equal(parseJdtComplianceMajor('21'), 21);
    });

    it('returns 0 for unparseable input', () => {
        assert.equal(parseJdtComplianceMajor('abc'), 0);
        assert.equal(parseJdtComplianceMajor(''), 0);
    });
});

// Business rules:
// - Only compiler compliance is compared; the resolved VM path is deliberately
//   not verified (a user-chosen JDK for the same version is legitimate).
// - Unreadable/missing values degrade to 'unknown', never 'mismatch'.

describe('verifyProjectCompliance', () => {
    const expected = {projectPath: '/ws/app', javaVersion: '17'};

    it('reports ok when the resolved compliance matches the pom version', () => {
        const result = verifyProjectCompliance(expected, {[COMPILER_COMPLIANCE_KEY]: '17'});
        assert.equal(result.status, 'ok');
        assert.equal(result.expectedMajor, 17);
        assert.equal(result.actualCompliance, '17');
    });

    it('matches legacy 1.8 compliance against a Java 8 pom', () => {
        const result = verifyProjectCompliance(
            {projectPath: '/ws/legacy', javaVersion: '8'},
            {[COMPILER_COMPLIANCE_KEY]: '1.8'},
        );
        assert.equal(result.status, 'ok');
    });

    it('reports mismatch when the Language Server resolved a different level', () => {
        const result = verifyProjectCompliance(expected, {[COMPILER_COMPLIANCE_KEY]: '21'});
        assert.equal(result.status, 'mismatch');
        assert.equal(result.actualCompliance, '21');
    });

    it('reports unknown when project settings are unavailable', () => {
        const result = verifyProjectCompliance(expected, undefined);
        assert.equal(result.status, 'unknown');
    });

    it('reports unknown when the compliance key is absent or empty', () => {
        assert.equal(verifyProjectCompliance(expected, {}).status, 'unknown');
        assert.equal(
            verifyProjectCompliance(expected, {[COMPILER_COMPLIANCE_KEY]: ''}).status,
            'unknown',
        );
    });

    it('reports unknown when the compliance value is unparseable', () => {
        const result = verifyProjectCompliance(expected, {[COMPILER_COMPLIANCE_KEY]: 'weird'});
        assert.equal(result.status, 'unknown');
    });

    it('reports unknown when the expected version itself is unparseable', () => {
        const result = verifyProjectCompliance(
            {projectPath: '/ws/broken', javaVersion: 'not-a-version'},
            {[COMPILER_COMPLIANCE_KEY]: '17'},
        );
        assert.equal(result.status, 'unknown');
    });
});
