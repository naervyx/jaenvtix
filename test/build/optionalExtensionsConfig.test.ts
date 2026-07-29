import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    detectOptionalExtensionConfig,
    selectInitializrDefaultJavaVersion,
    selectLanguageServerJdkHome,
} from '../../src/build/optionalExtensionsConfig';
import type {VersionPath} from '../../src/core/types';

function versionPaths(entries: Record<string, string>): Map<string, VersionPath> {
    return new Map(Object.entries(entries).map(([version, jdkHome]) => [
        version,
        {jdkHome, toolHome: `/maven/${version}`, toolBin: `/maven/${version}/bin`},
    ]));
}

const installedSet = (...ids: string[]) => (extensionId: string) => ids.includes(extensionId);

const noInitializr = {initializrDefaultJavaVersion: undefined};

describe('selectLanguageServerJdkHome', () => {
    it('returns the JDK home of a provisioned Java 21 version', () => {
        const paths = versionPaths({'21': '/jdks/21'});
        assert.equal(selectLanguageServerJdkHome(paths), '/jdks/21');
    });

    it('returns undefined when only Java < 21 versions are provisioned', () => {
        const paths = versionPaths({'17': '/jdks/17', '8': '/jdks/8'});
        assert.equal(selectLanguageServerJdkHome(paths), undefined);
    });

    it('prefers the highest qualifying version in a mixed workspace', () => {
        const paths = versionPaths({'17': '/jdks/17', '21': '/jdks/21', '25': '/jdks/25'});
        assert.equal(selectLanguageServerJdkHome(paths), '/jdks/25');
    });

    it('returns undefined for an empty map', () => {
        assert.equal(selectLanguageServerJdkHome(new Map()), undefined);
    });
});

// Business rules:
// - Only LTS releases >= 17 qualify (start.spring.io offers LTS only; Spring
//   Boot 3 requires Java 17).
// - The highest qualifying provisioned version wins.

describe('selectInitializrDefaultJavaVersion', () => {
    it('returns the highest provisioned LTS at or above 17', () => {
        const paths = versionPaths({'17': '/jdks/17', '21': '/jdks/21'});
        assert.equal(selectInitializrDefaultJavaVersion(paths), '21');
    });

    it('ignores LTS versions below the Spring Boot 3 floor (17)', () => {
        const paths = versionPaths({'8': '/jdks/8', '11': '/jdks/11'});
        assert.equal(selectInitializrDefaultJavaVersion(paths), undefined);
    });

    it('ignores non-LTS versions', () => {
        const paths = versionPaths({'18': '/jdks/18'});
        assert.equal(selectInitializrDefaultJavaVersion(paths), undefined);
    });

    it('returns undefined for an empty map', () => {
        assert.equal(selectInitializrDefaultJavaVersion(new Map()), undefined);
    });
});

describe('detectOptionalExtensionConfig', () => {
    it('returns one update when Spring Boot Tools is installed and a JDK 21+ exists', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: '/jdks/21', ...noInitializr},
            installedSet('vmware.vscode-spring-boot'),
        );

        assert.equal(updates.length, 1);
        assert.deepEqual(updates[0], {
            settingKey: 'spring-boot.ls.java.home',
            value: '/jdks/21',
            extensionId: 'vmware.vscode-spring-boot',
        });
    });

    it('returns an empty array when Spring Boot Tools is not installed', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: '/jdks/21', ...noInitializr},
            installedSet(),
        );
        assert.deepEqual(updates, []);
    });

    it('returns an empty array when no JDK 21+ is available', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: undefined, ...noInitializr},
            installedSet('vmware.vscode-spring-boot'),
        );
        assert.deepEqual(updates, []);
    });

    it('returns a single entry when both Spring Boot packs are installed', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: '/jdks/21', ...noInitializr},
            installedSet('vmware.vscode-spring-boot', 'vmware.vscode-boot-dev-pack'),
        );

        assert.equal(updates.length, 1);
    });

    it('seeds the Initializr default Java version when the extension is installed', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: undefined, initializrDefaultJavaVersion: '21'},
            installedSet('vscjava.vscode-spring-initializr'),
        );

        assert.deepEqual(updates, [{
            settingKey: 'spring.initializr.defaultJavaVersion',
            value: '21',
            extensionId: 'vscjava.vscode-spring-initializr',
        }]);
    });

    it('skips the Initializr update when the extension is absent', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: undefined, initializrDefaultJavaVersion: '21'},
            installedSet(),
        );
        assert.deepEqual(updates, []);
    });

    it('produces both updates when both extensions are installed', () => {
        const updates = detectOptionalExtensionConfig(
            {languageServerJdkHome: '/jdks/21', initializrDefaultJavaVersion: '21'},
            installedSet('vmware.vscode-spring-boot', 'vscjava.vscode-spring-initializr'),
        );

        assert.equal(updates.length, 2);
        assert.deepEqual(updates.map((u) => u.settingKey).sort(), [
            'spring-boot.ls.java.home',
            'spring.initializr.defaultJavaVersion',
        ]);
    });
});
