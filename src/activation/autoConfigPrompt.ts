/**
 * Possible decisions about whether (and how) to engage the user when a
 * workspace with `pom.xml` is opened:
 *
 * - `'auto-run'`: the user previously chose "Always" (a global preference);
 *   silently invoke the configuration command, no prompt.
 * - `'prompt'`: ask the user with the three-option message
 *   ("Yes" / "Always" / "No").
 * - `'skip'`: stay quiet — either there are no folders, or the user already
 *   answered "Yes"/"No" for THIS workspace.
 */
export type AutoConfigDecision = 'auto-run' | 'prompt' | 'skip';

/**
 * Pure decision: should Jaenvtix auto-run, prompt, or stay quiet for this
 * workspace?
 *
 * Business rules:
 * - With no workspace folders, there is nothing to configure → `'skip'`.
 * - The global "Always" preference (`alwaysAccepted === true`) takes
 *   priority over per-workspace state. If the user explicitly opted in
 *   globally, every workspace with a pom auto-runs without prompting.
 *   Workspace-local "No" answers from before the global opt-in are
 *   superseded.
 * - If "Always" is not set and the workspace already has a definitive
 *   answer (Yes or No, encoded as `dismissed === true`), respect it and
 *   `'skip'`. The user can re-run via the Command Palette.
 * - Otherwise, `'prompt'` — first time this workspace is being asked.
 */
export function decideAutoConfigAction(
    workspaceFolders: readonly {uri: {fsPath: string}}[] | undefined,
    workspaceDismissed: unknown,
    alwaysAccepted: unknown,
): AutoConfigDecision {
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return 'skip';
    }

    if (alwaysAccepted === true) {
        return 'auto-run';
    }

    if (workspaceDismissed === true) {
        return 'skip';
    }

    return 'prompt';
}

/**
 * Workspace-state key — set after the user answers Yes or No for THIS
 * specific workspace. The literal string is part of the persistence
 * contract: changing it would forget every existing dismissal/acceptance
 * and re-prompt every user once.
 */
export const AUTO_CONFIG_DISMISSED_KEY = 'jaenvtix.autoConfigPromptDismissed';

/**
 * Global-state key — set when the user picks "Always" in the prompt. From
 * then on, every workspace with a pom auto-configures silently. The flag
 * lives in `context.globalState` so it crosses workspaces and machines
 * (when sync settings is enabled).
 */
export const AUTO_CONFIG_ALWAYS_KEY = 'jaenvtix.autoConfigAlways';
