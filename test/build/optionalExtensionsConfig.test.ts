import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    detectOptionalExtensionConfig,
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

describe('detectOptionalExtensionConfig', () => {
    it('returns one update when Spring Boot Tools is installed and a JDK 21+ exists', () => {
        const updates = detectOptionalExtensionConfig('/jdks/21', installedSet('vmware.vscode-spring-boot'));

        assert.equal(updates.length, 1);
        assert.deepEqual(updates[0], {
            settingKey: 'spring-boot.ls.java.home',
            value: '/jdks/21',
            extensionId: 'vmware.vscode-spring-boot',
        });
    });

    it('returns an empty array when Spring Boot Tools is not installed', () => {
        const updates = detectOptionalExtensionConfig('/jdks/21', installedSet());
        assert.deepEqual(updates, []);
    });

    it('returns an empty array when no JDK 21+ is available', () => {
        const updates = detectOptionalExtensionConfig(undefined, installedSet('vmware.vscode-spring-boot'));
        assert.deepEqual(updates, []);
    });

    it('returns a single entry when both Spring Boot packs are installed', () => {
        const updates = detectOptionalExtensionConfig(
            '/jdks/21',
            installedSet('vmware.vscode-spring-boot', 'vmware.vscode-boot-dev-pack'),
        );

        assert.equal(updates.length, 1);
    });
});
