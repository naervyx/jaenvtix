import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {JAENVTIX_DEFAULT_SETTINGS} from '../../src/build/jaenvtixDefaultSettings';

interface PackageConfig {
    contributes: {
        configuration: {
            properties: Record<string, {default?: unknown}>;
        };
    };
}

function readPackageJaenvtixSettings(): Record<string, {default?: unknown}> {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as PackageConfig;
    const props = pkg.contributes.configuration.properties;
    return Object.fromEntries(
        Object.entries(props).filter(([key]) => key.startsWith('jaenvtix.')),
    );
}

describe('JAENVTIX_DEFAULT_SETTINGS — drift guard against package.json', () => {
    const pkgSettings = readPackageJaenvtixSettings();

    it('seeds exactly the jaenvtix.* settings contributed in package.json', () => {
        const seededKeys = JAENVTIX_DEFAULT_SETTINGS.map((setting) => setting.key).sort();
        const packageKeys = Object.keys(pkgSettings).sort();
        assert.deepEqual(seededKeys, packageKeys);
    });

    it('uses the same default as package.json for every setting', () => {
        for (const setting of JAENVTIX_DEFAULT_SETTINGS) {
            assert.deepEqual(
                setting.default,
                pkgSettings[setting.key]?.default,
                `default mismatch for ${setting.key}`,
            );
        }
    });
});
