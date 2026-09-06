import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTO_CONFIG_ALWAYS_KEY,
    AUTO_CONFIG_DISMISSED_KEY,
    decideAutoConfigAction,
} from '../../src/activation/autoConfigPrompt';

// Business rules:
// - The auto-config prompt only fires when the user actually has a workspace
//   open. With no folders there is literally nothing for Jaenvtix to do.
// - The global "Always" preference is the strongest signal: when set, every
//   workspace with a pom auto-runs silently, even those previously dismissed.
// - Without "Always", a per-workspace dismissal (Yes or No once) silences the
//   prompt for that workspace specifically.
// - Defensive: any persisted shape other than the literal `true` is treated
//   as "not yet decided". Corrupted/migrated state should not silently lock
//   the user out.
// - Nothing is configured while Java language support is missing, not even on
//   the silent "Always" path: the settings Jaenvtix writes would have no
//   consumer, so a successful run would be a false positive.
//
// Every case below passes `languageServerInstalled` explicitly; the ones that
// pass `true` describe the pre-existing behaviour, unchanged.

describe('decideAutoConfigAction', () => {
    const folder = {uri: {fsPath: '/some/workspace'}};

    it("returns 'skip' when no workspace folders are open", () => {
        assert.equal(decideAutoConfigAction(undefined, undefined, undefined, true), 'skip');
        assert.equal(decideAutoConfigAction([], undefined, undefined, true), 'skip');
        // Even with global "Always" set, no folders means nothing to do.
        assert.equal(decideAutoConfigAction([], undefined, true, true), 'skip');
    });

    it("returns 'auto-run' when the user previously chose 'Always' globally", () => {
        assert.equal(decideAutoConfigAction([folder], undefined, true, true), 'auto-run');
    });

    it("'Always' overrides a per-workspace dismissal — global preference wins", () => {
        // The user dismissed this specific workspace at some point but later
        // turned on "Always" globally. New global decision wins; this workspace
        // should now auto-run too.
        assert.equal(decideAutoConfigAction([folder], true, true, true), 'auto-run');
    });

    it("returns 'skip' when this workspace already received a Yes/No answer (no global Always)", () => {
        assert.equal(decideAutoConfigAction([folder], true, undefined, true), 'skip');
        assert.equal(decideAutoConfigAction([folder], true, false, true), 'skip');
    });

    it("returns 'prompt' on first encounter — no global Always, no workspace decision", () => {
        assert.equal(decideAutoConfigAction([folder], undefined, undefined, true), 'prompt');
    });

    it("treats values other than the literal `true` as 'not yet decided'", () => {
        // Defensive: corrupted/migrated workspaceState should not silence the prompt.
        assert.equal(decideAutoConfigAction([folder], false, undefined, true), 'prompt');
        assert.equal(decideAutoConfigAction([folder], null, undefined, true), 'prompt');
        assert.equal(decideAutoConfigAction([folder], 'true', undefined, true), 'prompt');
        assert.equal(decideAutoConfigAction([folder], 1, undefined, true), 'prompt');
        // Same for global state.
        assert.equal(decideAutoConfigAction([folder], undefined, 'true', true), 'prompt');
        assert.equal(decideAutoConfigAction([folder], undefined, 1, true), 'prompt');
    });

    it("returns 'prompt-install' on first encounter when language support is missing", () => {
        assert.equal(decideAutoConfigAction([folder], undefined, undefined, false), 'prompt-install');
    });

    it("returns 'skip-no-language-support' for 'Always' when language support is missing", () => {
        // "Always" means "stop asking me", so this path never prompts. And it
        // never configures either: writing settings nothing can consume would
        // be a silent false positive.
        assert.equal(decideAutoConfigAction([folder], undefined, true, false), 'skip-no-language-support');
        assert.equal(decideAutoConfigAction([folder], true, true, false), 'skip-no-language-support');
    });

    it('checks language support before the Always shortcut, not after', () => {
        // Ordering matters: with the checks reversed, an "Always" user would
        // silently configure an environment where nothing works.
        assert.equal(decideAutoConfigAction([folder], undefined, true, true), 'auto-run');
        assert.notEqual(decideAutoConfigAction([folder], undefined, true, false), 'auto-run');
    });

    it("keeps 'skip' ahead of the language-support gate for an answered workspace", () => {
        // The user already said Yes or No here. Missing language support does
        // not reopen that question.
        assert.equal(decideAutoConfigAction([folder], true, undefined, false), 'skip');
    });

    it("returns 'skip' with no folders regardless of language support", () => {
        assert.equal(decideAutoConfigAction([], undefined, undefined, false), 'skip');
        assert.equal(decideAutoConfigAction(undefined, undefined, true, false), 'skip');
    });

    it('exposes stable persistence keys so existing user state survives across releases', () => {
        // Changing either literal would forget every prior dismissal/preference
        // and re-prompt every user once.
        assert.equal(AUTO_CONFIG_DISMISSED_KEY, 'jaenvtix.autoConfigPromptDismissed');
        assert.equal(AUTO_CONFIG_ALWAYS_KEY, 'jaenvtix.autoConfigAlways');
    });
});
