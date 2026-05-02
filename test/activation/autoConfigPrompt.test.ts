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

describe('decideAutoConfigAction', () => {
    const folder = {uri: {fsPath: '/some/workspace'}};

    it("returns 'skip' when no workspace folders are open", () => {
        assert.equal(decideAutoConfigAction(undefined, undefined, undefined), 'skip');
        assert.equal(decideAutoConfigAction([], undefined, undefined), 'skip');
        // Even with global "Always" set, no folders means nothing to do.
        assert.equal(decideAutoConfigAction([], undefined, true), 'skip');
    });

    it("returns 'auto-run' when the user previously chose 'Always' globally", () => {
        assert.equal(decideAutoConfigAction([folder], undefined, true), 'auto-run');
    });

    it("'Always' overrides a per-workspace dismissal — global preference wins", () => {
        // The user dismissed this specific workspace at some point but later
        // turned on "Always" globally. New global decision wins; this workspace
        // should now auto-run too.
        assert.equal(decideAutoConfigAction([folder], true, true), 'auto-run');
    });

    it("returns 'skip' when this workspace already received a Yes/No answer (no global Always)", () => {
        assert.equal(decideAutoConfigAction([folder], true, undefined), 'skip');
        assert.equal(decideAutoConfigAction([folder], true, false), 'skip');
    });

    it("returns 'prompt' on first encounter — no global Always, no workspace decision", () => {
        assert.equal(decideAutoConfigAction([folder], undefined, undefined), 'prompt');
    });

    it("treats values other than the literal `true` as 'not yet decided'", () => {
        // Defensive: corrupted/migrated workspaceState should not silence the prompt.
        assert.equal(decideAutoConfigAction([folder], false, undefined), 'prompt');
        assert.equal(decideAutoConfigAction([folder], null, undefined), 'prompt');
        assert.equal(decideAutoConfigAction([folder], 'true', undefined), 'prompt');
        assert.equal(decideAutoConfigAction([folder], 1, undefined), 'prompt');
        // Same for global state.
        assert.equal(decideAutoConfigAction([folder], undefined, 'true'), 'prompt');
        assert.equal(decideAutoConfigAction([folder], undefined, 1), 'prompt');
    });

    it('exposes stable persistence keys so existing user state survives across releases', () => {
        // Changing either literal would forget every prior dismissal/preference
        // and re-prompt every user once.
        assert.equal(AUTO_CONFIG_DISMISSED_KEY, 'jaenvtix.autoConfigPromptDismissed');
        assert.equal(AUTO_CONFIG_ALWAYS_KEY, 'jaenvtix.autoConfigAlways');
    });
});
