import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';

import {parseToolchainsXml, readToolchainsXml} from '../../src/build/toolchainsXmlReader';
import {createTempDir, removeTempDir, writeTempFile} from '../fixtures/tempDir';

function jdkToolchain(jdkHome: string, provides = ''): string {
    return [
        '    <toolchain>',
        '        <type>jdk</type>',
        provides,
        '        <configuration>',
        `            <jdkHome>${jdkHome}</jdkHome>`,
        '        </configuration>',
        '    </toolchain>',
    ].join('\n');
}

describe('parseToolchainsXml', () => {
    it('returns all JDK toolchains with their jdkHome', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n${jdkToolchain('/opt/jdk-17')}\n${jdkToolchain('/opt/jdk-21')}\n</toolchains>`;

        const entries = parseToolchainsXml(xml);

        assert.deepEqual(entries.map((entry) => entry.jdkHome), ['/opt/jdk-17', '/opt/jdk-21']);
    });

    it('ignores toolchains of other types', () => {
        const mavenToolchain = [
            '    <toolchain>',
            '        <type>maven</type>',
            '        <configuration>',
            '            <mvnHome>/opt/maven</mvnHome>',
            '        </configuration>',
            '    </toolchain>',
        ].join('\n');
        const xml = `<toolchains>\n${mavenToolchain}\n${jdkToolchain('/opt/jdk-17')}\n</toolchains>`;

        const entries = parseToolchainsXml(xml);

        assert.equal(entries.length, 1);
        assert.equal(entries[0]?.jdkHome, '/opt/jdk-17');
    });

    it('captures version and vendor from the provides block', () => {
        const provides = [
            '        <provides>',
            '            <version>17</version>',
            '            <vendor>corretto</vendor>',
            '        </provides>',
        ].join('\n');
        const entries = parseToolchainsXml(`<toolchains>\n${jdkToolchain('/opt/jdk-17-corretto', provides)}\n</toolchains>`);

        assert.deepEqual(entries, [{
            jdkHome: '/opt/jdk-17-corretto',
            version: '17',
            vendor: 'corretto',
        }]);
    });

    it('leaves version and vendor undefined when only jdkHome is present', () => {
        const entries = parseToolchainsXml(`<toolchains>\n${jdkToolchain('/opt/jdk-11')}\n</toolchains>`);

        assert.equal(entries.length, 1);
        assert.equal(entries[0]?.version, undefined);
        assert.equal(entries[0]?.vendor, undefined);
    });

    it('returns an empty array for malformed XML without crashing', () => {
        const entries = parseToolchainsXml('<toolchains><toolchain><type>jdk</type><configuration>');

        assert.deepEqual(entries, []);
    });

    it('skips a jdk toolchain without jdkHome', () => {
        const xml = '<toolchains><toolchain><type>jdk</type><configuration></configuration></toolchain></toolchains>';

        assert.deepEqual(parseToolchainsXml(xml), []);
    });
});

describe('readToolchainsXml', () => {
    let tempDir: string;

    before(async () => { tempDir = await createTempDir(); });
    after(async () => { await removeTempDir(tempDir); });

    it('returns an empty array when the file does not exist', () => {
        const entries = readToolchainsXml(join(tempDir, 'missing-toolchains.xml'));

        assert.deepEqual(entries, []);
    });

    it('reads JDK toolchains from an existing file', async () => {
        const xml = `<toolchains>\n${jdkToolchain('/opt/jdk-17')}\n</toolchains>`;
        const filePath = await writeTempFile(tempDir, 'toolchains.xml', Buffer.from(xml, 'utf-8'));

        const entries = readToolchainsXml(filePath);

        assert.deepEqual(entries.map((entry) => entry.jdkHome), ['/opt/jdk-17']);
    });
});
