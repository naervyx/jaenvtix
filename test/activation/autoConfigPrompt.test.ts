import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTO_CONFIG_GENERATION_KEY,
    AUTO_CONFIG_RECORD_KEY,
    decideAutoConfigAction,
    normalizeGeneration,
    normalizeRecord,
} from '../../src/activation/autoConfigPrompt';

// Business rules:
// - The trigger is the STATE OF THE PROJECT, not whether the user was once
//   asked. A project with a pom and no configuration needs configuring, and a
//   past answer does not configure anything today.
// - The single exception is "No": permanent, and what stops the rule above
//   from nagging someone who deliberately keeps .vscode out of a repository.
// - A reset outranks everything below it, "already configured" included.
//   Someone who runs the reset asked to be questioned again.
// - Which question gets asked is decided by the environment right now: no
//   language server means the install prompt, never the plain one.
// - Defensive: anything the normalizer does not recognize is "never answered".
//   Unreadable state must fail towards asking, never towards a silence the
//   user has no way out of.

/** The earlier persisted shape: a bare `true`, polarity unrecorded. */
const LEGACY = true;
const accepted = {answer: 'accepted', generation: 0};
const declined = {answer: 'declined', generation: 0};

const CONFIGURED = true;
const UNCONFIGURED = false;
const HAS_LS = true;
const NO_LS = false;

describe('decideAutoConfigAction', () => {
    const folder = {uri: {fsPath: '/some/workspace'}};

    it('returns skip when no workspace folders are open', () => {
        assert.equal(decideAutoConfigAction(undefined, undefined, HAS_LS, UNCONFIGURED), 'skip');
        assert.equal(decideAutoConfigAction([], undefined, HAS_LS, UNCONFIGURED), 'skip');
    });

    it('asks on first encounter, and the environment picks the question', () => {
        assert.equal(decideAutoConfigAction([folder], undefined, HAS_LS, UNCONFIGURED), 'prompt');
        assert.equal(decideAutoConfigAction([folder], undefined, NO_LS, UNCONFIGURED), 'prompt-install');
    });

    it('returns skip for a configured workspace, which is the common case', () => {
        assert.equal(decideAutoConfigAction([folder], accepted, HAS_LS, CONFIGURED), 'skip');
        assert.equal(decideAutoConfigAction([folder], LEGACY, HAS_LS, CONFIGURED), 'skip');
    });

    it('asks again when an accepted workspace lost its configuration', () => {
        // The rule this whole change exists for: deleting .vscode makes the
        // project unconfigured, and a past Yes does not configure it today.
        assert.equal(decideAutoConfigAction([folder], accepted, HAS_LS, UNCONFIGURED), 'prompt');
        assert.equal(decideAutoConfigAction([folder], accepted, NO_LS, UNCONFIGURED), 'prompt-install');
    });

    it('asks again for a legacy record whose workspace is unconfigured', () => {
        assert.equal(decideAutoConfigAction([folder], LEGACY, HAS_LS, UNCONFIGURED), 'prompt');
    });

    it('keeps a decline permanent, configured or not', () => {
        // The one guard rail. Without it, anyone who keeps .vscode out of the
        // repository on purpose would be asked on every single open.
        assert.equal(decideAutoConfigAction([folder], declined, HAS_LS, UNCONFIGURED), 'skip');
        assert.equal(decideAutoConfigAction([folder], declined, NO_LS, UNCONFIGURED), 'skip');
        assert.equal(decideAutoConfigAction([folder], declined, HAS_LS, CONFIGURED), 'skip');
    });

    it('never picks the plain prompt while language support is missing', () => {
        for (const record of [undefined, LEGACY, accepted]) {
            assert.notEqual(decideAutoConfigAction([folder], record, NO_LS, UNCONFIGURED), 'prompt');
        }
    });

    it('treats unrecognized persisted values as never answered', () => {
        for (const raw of [false, null, 'true', 1, {}, {answer: 'maybe'}]) {
            assert.equal(decideAutoConfigAction([folder], raw, HAS_LS, UNCONFIGURED), 'prompt');
        }
    });

    it('exposes stable persistence keys so existing user state survives across releases', () => {
        assert.equal(AUTO_CONFIG_RECORD_KEY, 'jaenvtix.autoConfigPromptDismissed');
        assert.equal(AUTO_CONFIG_GENERATION_KEY, 'jaenvtix.autoConfigGeneration');
    });
});

describe('decideAutoConfigAction reset generation', () => {
    const folder = {uri: {fsPath: '/some/workspace'}};

    it('ignores a record older than the current generation', () => {
        const record = {answer: 'accepted', generation: 2};
        assert.equal(decideAutoConfigAction([folder], record, HAS_LS, CONFIGURED, 2), 'skip');
        assert.equal(decideAutoConfigAction([folder], record, HAS_LS, CONFIGURED, 3), 'prompt');
    });

    it('outranks already-configured, because that is what a reset is for', () => {
        assert.equal(decideAutoConfigAction([folder], accepted, HAS_LS, CONFIGURED, 1), 'prompt');
    });

    it('outranks a decline too, so one command really clears everything', () => {
        assert.equal(decideAutoConfigAction([folder], declined, HAS_LS, CONFIGURED, 1), 'prompt');
    });

    it('sweeps legacy records, which all carry generation 0', () => {
        assert.equal(decideAutoConfigAction([folder], LEGACY, HAS_LS, CONFIGURED, 1), 'prompt');
    });

    it('treats a record from a FUTURE generation as current, never as stale', () => {
        // Defensive: a rolled-back globalState must not ask forever.
        const record = {answer: 'accepted', generation: 5};
        assert.equal(decideAutoConfigAction([folder], record, HAS_LS, CONFIGURED, 1), 'skip');
    });
});

describe('normalizeRecord', () => {
    it('reads the legacy literal true as accepted, with no path list', () => {
        assert.deepEqual(normalizeRecord(true), {answer: 'accepted', generation: 0});
    });

    it('never reads an unreadable value as a decline', () => {
        // Guessing a decline would silence a workspace forever on a guess.
        for (const raw of [false, null, 1, 'declined', {}, {answer: 'nope'}]) {
            assert.notEqual(normalizeRecord(raw)?.answer, 'declined');
        }
    });

    it('keeps a valid path list', () => {
        assert.deepEqual(
            normalizeRecord({answer: 'accepted', generation: 3, configured: ['/a/.vscode/settings.json']}),
            {answer: 'accepted', generation: 3, configured: ['/a/.vscode/settings.json']},
        );
    });

    it('drops a malformed path list but keeps the answer', () => {
        // A broken list must fall back to the filesystem probe, not to silence.
        for (const configured of ['nope', [1, 2], ['', '/a'], {}]) {
            const record = normalizeRecord({answer: 'accepted', generation: 0, configured});
            assert.equal(record?.answer, 'accepted');
            assert.equal(record?.configured, undefined);
        }
    });

    it('defaults a missing or unusable generation to 0', () => {
        assert.equal(normalizeRecord({answer: 'declined'})?.generation, 0);
        assert.equal(normalizeRecord({answer: 'declined', generation: -1})?.generation, 0);
    });

    it('returns undefined for anything it does not recognize', () => {
        assert.equal(normalizeRecord(undefined), undefined);
        assert.equal(normalizeRecord(false), undefined);
        assert.equal(normalizeRecord(null), undefined);
        assert.equal(normalizeRecord('true'), undefined);
        assert.equal(normalizeRecord(1), undefined);
        assert.equal(normalizeRecord({}), undefined);
    });
});

describe('normalizeGeneration', () => {
    it('keeps finite non-negative numbers, floored', () => {
        assert.equal(normalizeGeneration(0), 0);
        assert.equal(normalizeGeneration(7), 7);
        assert.equal(normalizeGeneration(2.9), 2);
    });

    it('reads anything else as generation 0', () => {
        assert.equal(normalizeGeneration(undefined), 0);
        assert.equal(normalizeGeneration(-1), 0);
        assert.equal(normalizeGeneration(Number.NaN), 0);
        assert.equal(normalizeGeneration(Number.POSITIVE_INFINITY), 0);
        assert.equal(normalizeGeneration('3'), 0);
    });
});
