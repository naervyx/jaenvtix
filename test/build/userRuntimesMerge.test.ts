import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {mergeUserRuntimes, JavaRuntime} from '../../src/build/userRuntimesMerge';

// Business rule: Jaenvtix populates the user's `java.configuration.runtimes`
// cooperatively. The Red Hat Language Server reads this array to resolve which
// JDK to use per Maven project. Whatever the user already mapped is sacred —
// Jaenvtix only ADDS missing entries and never overwrites existing ones.

describe('mergeUserRuntimes', () => {
    it('preserves the user mapping when an entry with the same name already exists', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/own/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].path, '/user/own/jdk-17');
    });

    it('does not duplicate when an existing entry already points to the candidate path (regardless of name)', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'Java-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].name, 'JavaSE-21');
    });

    it('appends candidates that share neither name nor path with any existing entry', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/own/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
            {name: 'JavaSE-11', path: '/.jaenvtix/jdk-11'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, true);
        assert.equal(merged.length, 3);
        assert.deepEqual(
            merged.map((r) => r.name).sort(),
            ['JavaSE-11', 'JavaSE-17', 'JavaSE-21'],
        );
    });

    it("preserves existing entries' default flag without copying it to new entries", () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17', default: true},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged} = mergeUserRuntimes(existing, candidates);

        const existingEntry = merged.find((r) => r.name === 'JavaSE-17');
        const newEntry = merged.find((r) => r.name === 'JavaSE-21');
        assert.equal(existingEntry?.default, true);
        assert.equal(newEntry?.default, undefined);
    });

    it('preserves sources/javadoc fields the user had configured on existing entries', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17', sources: '/user/src', javadoc: '/user/doc'},
        ];
        const candidates: JavaRuntime[] = [];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged[0].sources, '/user/src');
        assert.equal(merged[0].javadoc, '/user/doc');
    });

    it('reports updated=false (no-op) when every candidate is already covered', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/.jaenvtix/jdk-17'},
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        const {merged, updated} = mergeUserRuntimes(existing, candidates);

        assert.equal(updated, false);
        assert.equal(merged.length, 2);
    });

    it('does not mutate the input arrays', () => {
        const existing: JavaRuntime[] = [
            {name: 'JavaSE-17', path: '/user/jdk-17'},
        ];
        const candidates: JavaRuntime[] = [
            {name: 'JavaSE-21', path: '/.jaenvtix/jdk-21'},
        ];

        mergeUserRuntimes(existing, candidates);

        assert.equal(existing.length, 1);
        assert.equal(candidates.length, 1);
    });
});
