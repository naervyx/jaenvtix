import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRecommendedExtensionPickItems,
    RECOMMENDED_EXTENSIONS,
} from '../../src/build/recommendedExtensions';

describe('RECOMMENDED_EXTENSIONS', () => {
    it('has 3 entries with non-empty id, name, description, and reason', () => {
        assert.equal(RECOMMENDED_EXTENSIONS.length, 3);
        for (const extension of RECOMMENDED_EXTENSIONS) {
            assert.ok(extension.id.length > 0);
            assert.ok(extension.name.length > 0);
            assert.ok(extension.description.length > 0);
            assert.ok(extension.reason.length > 0);
        }
    });

    it('covers the canonical Java, Spring Boot, and XML extensions', () => {
        const ids = RECOMMENDED_EXTENSIONS.map((extension) => extension.id);
        assert.deepEqual(
            [...ids].sort(),
            ['redhat.vscode-xml', 'vmware.vscode-boot-dev-pack', 'vscjava.vscode-java-pack'],
        );
    });
});

describe('buildRecommendedExtensionPickItems', () => {
    it('pre-picks every extension when none is installed', () => {
        const items = buildRecommendedExtensionPickItems(() => false);

        assert.equal(items.length, 3);
        assert.ok(items.every((item) => item.picked && !item.isInstalled));
        assert.ok(items.every((item) => item.description === item.extensionId));
    });

    it('marks installed extensions "(already installed)" and does not pre-pick them', () => {
        const items = buildRecommendedExtensionPickItems((id) => id === 'vscjava.vscode-java-pack');
        const javaPack = items.find((item) => item.extensionId === 'vscjava.vscode-java-pack');
        const others = items.filter((item) => item.extensionId !== 'vscjava.vscode-java-pack');

        assert.ok(javaPack);
        assert.equal(javaPack.picked, false);
        assert.equal(javaPack.isInstalled, true);
        assert.equal(javaPack.description, '(already installed)');
        assert.ok(others.every((item) => item.picked));
    });
});
