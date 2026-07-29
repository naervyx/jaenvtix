import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    createMismatchMemento,
    LAST_VERIFICATION_MISMATCH_KEY,
    readMismatchBacklog,
} from '../../src/configuration/mismatchMemento';

// Business rules:
// - The memento key is a persistence contract: it must never change.
// - Corrupt/legacy stored values degrade to an empty backlog, never break.
// - An empty backlog removes the key (no residue in workspace storage).

describe('readMismatchBacklog', () => {
    it('accepts a valid array of project paths', () => {
        assert.deepEqual(readMismatchBacklog(['/ws/a', '/ws/b']), ['/ws/a', '/ws/b']);
    });

    it('degrades non-array values to an empty backlog', () => {
        assert.deepEqual(readMismatchBacklog(undefined), []);
        assert.deepEqual(readMismatchBacklog(null), []);
        assert.deepEqual(readMismatchBacklog('not-an-array'), []);
        assert.deepEqual(readMismatchBacklog({0: '/ws/a'}), []);
    });

    it('drops non-string and empty entries from a mixed array', () => {
        assert.deepEqual(readMismatchBacklog(['/ws/a', 42, null, '', '/ws/b']), ['/ws/a', '/ws/b']);
    });
});

describe('createMismatchMemento', () => {
    function fakeMemento(): {store: Map<string, unknown>; get(key: string): unknown; update(key: string, value: unknown): Promise<void>} {
        const store = new Map<string, unknown>();
        return {
            store,
            get: (key) => store.get(key),
            update: async (key, value) => {
                if (value === undefined) {
                    store.delete(key);
                } else {
                    store.set(key, value);
                }
            },
        };
    }

    it('uses the contracted key (renaming it would drop every user backlog)', async () => {
        assert.equal(LAST_VERIFICATION_MISMATCH_KEY, 'jaenvtix.lastVerificationMismatch');

        const memento = fakeMemento();
        await createMismatchMemento(memento).update(['/ws/a']);
        assert.deepEqual(memento.store.get(LAST_VERIFICATION_MISMATCH_KEY), ['/ws/a']);
    });

    it('round-trips a backlog through get/update', async () => {
        const accessor = createMismatchMemento(fakeMemento());

        assert.deepEqual(accessor.get(), []);
        await accessor.update(['/ws/app', '/ws/lib']);
        assert.deepEqual(accessor.get(), ['/ws/app', '/ws/lib']);
    });

    it('clears the key entirely when updated with an empty backlog', async () => {
        const memento = fakeMemento();
        const accessor = createMismatchMemento(memento);

        await accessor.update(['/ws/app']);
        await accessor.update([]);

        assert.equal(memento.store.has(LAST_VERIFICATION_MISMATCH_KEY), false);
    });

    it('sanitizes corrupt stored values on read', () => {
        const memento = fakeMemento();
        memento.store.set(LAST_VERIFICATION_MISMATCH_KEY, {broken: true});

        assert.deepEqual(createMismatchMemento(memento).get(), []);
    });
});
