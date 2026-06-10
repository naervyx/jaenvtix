import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseMavenVersionFromPom, parseMavenVersionFromXml} from '../../src/search/mavenVersion';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

function pom(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<project>\n${body}\n</project>`;
}

describe('parseMavenVersionFromXml', () => {
    it('reads <prerequisites><maven>', () => {
        const xml = pom('<prerequisites><maven>3.6.3</maven></prerequisites>');

        assert.equal(parseMavenVersionFromXml(xml), '3.6.3');
    });

    it('reads <properties><maven.version>', () => {
        const xml = pom('<properties><maven.version>3.9.5</maven.version></properties>');

        assert.equal(parseMavenVersionFromXml(xml), '3.9.5');
    });

    it('returns null when nothing is pinned', () => {
        const xml = pom('<properties><java.version>21</java.version></properties>');

        assert.equal(parseMavenVersionFromXml(xml), null);
    });

    it('prefers prerequisites when both are present', () => {
        const xml = pom([
            '<properties><maven.version>3.9.5</maven.version></properties>',
            '<prerequisites><maven>3.6.3</maven></prerequisites>',
        ].join('\n'));

        assert.equal(parseMavenVersionFromXml(xml), '3.6.3');
    });

    it('ignores property placeholders and non-numeric values', () => {
        const xml = pom('<prerequisites><maven>${maven.min.version}</maven></prerequisites>');

        assert.equal(parseMavenVersionFromXml(xml), null);
    });

    it('does not confuse a nested <maven> outside <project><prerequisites>', () => {
        const xml = pom('<build><plugins><plugin><configuration><maven>3.0.0</maven></configuration></plugin></plugins></build>');

        assert.equal(parseMavenVersionFromXml(xml), null);
    });
});

describe('parseMavenVersionFromPom', () => {
    let tempDir: string;

    before(async () => { tempDir = await createTempDir('jaenvtix-mvn-pom-'); });
    after(async () => { await removeTempDir(tempDir); });

    it('reads the pinned version from a project directory', () => {
        const project = join(tempDir, 'pinned');
        mkdirSync(project, {recursive: true});
        writeFileSync(join(project, 'pom.xml'), pom('<prerequisites><maven>3.8.8</maven></prerequisites>'));

        assert.equal(parseMavenVersionFromPom(project), '3.8.8');
    });

    it('returns null when the pom does not exist', () => {
        assert.equal(parseMavenVersionFromPom(join(tempDir, 'missing')), null);
    });
});
