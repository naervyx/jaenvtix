import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {mergeToolchainsXml, parseJdkVendor, ToolchainEntry} from '../../src/build/toolchainsXml';

// Business rules:
// - Jaenvtix generates ~/.m2/toolchains.xml so projects opting into
//   maven-toolchains-plugin can resolve their JDK without manual setup.
// - The merge MUST preserve toolchains the user (or another tool) authored.
// - De-duplication is by `<jdkHome>` path: a single JDK should produce a
//   single toolchain entry regardless of vendor/version metadata.

describe('parseJdkVendor', () => {
    it('extracts the first word of IMPLEMENTOR, lowercased and stripped of punctuation', () => {
        assert.equal(parseJdkVendor('IMPLEMENTOR="Amazon.com Inc."\n'), 'amazoncom');
        assert.equal(parseJdkVendor('IMPLEMENTOR="Eclipse Adoptium"\n'), 'eclipse');
        assert.equal(parseJdkVendor('IMPLEMENTOR="Oracle Corporation"\n'), 'oracle');
        assert.equal(parseJdkVendor('IMPLEMENTOR="Azul Systems, Inc."\n'), 'azul');
    });

    it('returns "unknown" when IMPLEMENTOR is missing or empty', () => {
        assert.equal(parseJdkVendor(''), 'unknown');
        assert.equal(parseJdkVendor('JAVA_VERSION="17.0.19"\n'), 'unknown');
        assert.equal(parseJdkVendor('IMPLEMENTOR=""\n'), 'unknown');
    });
});

describe('mergeToolchainsXml', () => {
    function entry(jdkHome: string, version: string, vendor = 'amazon'): ToolchainEntry {
        return {jdkHome, version, vendor};
    }

    it('bootstraps a minimal toolchains document when the input is empty', () => {
        const {xml, updated} = mergeToolchainsXml('', [entry('/jdk-17', '17')]);
        assert.equal(updated, true);
        assert.match(xml, /<\?xml version="1\.0"/);
        assert.match(xml, /<toolchains>/);
        assert.match(xml, /<\/toolchains>/);
        assert.match(xml, /<jdkHome>\/jdk-17<\/jdkHome>/);
    });

    it('preserves user-authored toolchains verbatim', () => {
        const userXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<toolchains>',
            '    <toolchain>',
            '        <type>jdk</type>',
            '        <provides>',
            '            <version>17</version>',
            '            <vendor>my-cool-vendor</vendor>',
            '        </provides>',
            '        <configuration>',
            '            <jdkHome>/user/own/jdk-17</jdkHome>',
            '        </configuration>',
            '    </toolchain>',
            '</toolchains>',
            '',
        ].join('\n');

        const {xml} = mergeToolchainsXml(userXml, [entry('/.jaenvtix/jdk-21', '21')]);

        assert.match(xml, /<vendor>my-cool-vendor<\/vendor>/);
        assert.match(xml, /<jdkHome>\/user\/own\/jdk-17<\/jdkHome>/);
        assert.match(xml, /<jdkHome>\/\.jaenvtix\/jdk-21<\/jdkHome>/);
    });

    it('does NOT duplicate when an existing toolchain references the same jdkHome', () => {
        const existingXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<toolchains>',
            '    <toolchain>',
            '        <type>jdk</type>',
            '        <provides><version>17</version><vendor>amazon</vendor></provides>',
            '        <configuration><jdkHome>/jdk-17</jdkHome></configuration>',
            '    </toolchain>',
            '</toolchains>',
        ].join('\n');

        const {xml, updated} = mergeToolchainsXml(existingXml, [entry('/jdk-17', '17')]);

        assert.equal(updated, false);
        const matches = xml.match(/<jdkHome>\/jdk-17<\/jdkHome>/g) ?? [];
        assert.equal(matches.length, 1);
    });

    it('adds new toolchains immediately before </toolchains>, keeping existing entries first', () => {
        const existingXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<toolchains>',
            '    <toolchain>',
            '        <type>jdk</type>',
            '        <provides><version>17</version><vendor>amazon</vendor></provides>',
            '        <configuration><jdkHome>/jdk-17</jdkHome></configuration>',
            '    </toolchain>',
            '</toolchains>',
        ].join('\n');

        const {xml, updated} = mergeToolchainsXml(existingXml, [entry('/jdk-21', '21')]);

        assert.equal(updated, true);
        const idx17 = xml.indexOf('<jdkHome>/jdk-17</jdkHome>');
        const idx21 = xml.indexOf('<jdkHome>/jdk-21</jdkHome>');
        const idxClose = xml.indexOf('</toolchains>');
        assert.ok(idx17 < idx21, 'existing toolchain (17) should appear before new one (21)');
        assert.ok(idx21 < idxClose, 'new toolchain (21) should appear before </toolchains>');
    });

    it('reports updated=false when every candidate is already present', () => {
        const existingXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<toolchains>',
            '    <toolchain>',
            '        <type>jdk</type>',
            '        <provides><version>17</version><vendor>amazon</vendor></provides>',
            '        <configuration><jdkHome>/jdk-17</jdkHome></configuration>',
            '    </toolchain>',
            '    <toolchain>',
            '        <type>jdk</type>',
            '        <provides><version>21</version><vendor>amazon</vendor></provides>',
            '        <configuration><jdkHome>/jdk-21</jdkHome></configuration>',
            '    </toolchain>',
            '</toolchains>',
        ].join('\n');

        const {updated} = mergeToolchainsXml(existingXml, [
            entry('/jdk-17', '17'),
            entry('/jdk-21', '21'),
        ]);

        assert.equal(updated, false);
    });

    it('does not insert the same candidate twice when the input list contains duplicates', () => {
        const {xml} = mergeToolchainsXml('', [
            entry('/jdk-17', '17'),
            entry('/jdk-17', '17'),
        ]);

        const matches = xml.match(/<jdkHome>\/jdk-17<\/jdkHome>/g) ?? [];
        assert.equal(matches.length, 1);
    });

    it('uses the legacy 1.x form when generating an entry for Java 8 (caller responsibility, but verify pass-through)', () => {
        const {xml} = mergeToolchainsXml('', [entry('/jdk-8', '1.8')]);
        assert.match(xml, /<version>1\.8<\/version>/);
    });

    it('rebuilds the document when the existing XML is missing the closing tag', () => {
        const broken = '<?xml version="1.0"?><toolchains><toolchain><type>jdk</type></toolchain>';

        const {xml, updated} = mergeToolchainsXml(broken, [entry('/jdk-17', '17')]);

        assert.equal(updated, true);
        assert.match(xml, /<\/toolchains>/);
        assert.match(xml, /<jdkHome>\/jdk-17<\/jdkHome>/);
        // The malformed content is dropped intentionally — see mergeToolchainsXml docs.
    });
});
