/**
 * Possible decisions about whether (and how) to engage the user when a
 * workspace with `pom.xml` is opened:
 *
 * - `'auto-run'`: the user previously chose "Always" (a global preference);
 *   silently invoke the configuration command, no prompt.
 * - `'prompt'`: ask the user with the three-option message
 *   ("Yes" / "Always" / "No").
 * - `'prompt-install'`: same moment, but Java language support is missing, so
 *   the two-option message offering to install it first is shown instead.
 * - `'skip-no-language-support'`: the user chose "Always" but nothing can
 *   consume what would be provisioned; stay silent and log why.
 * - `'skip'`: stay quiet — either there are no folders, or the user already
 *   answered "Yes"/"No" for THIS workspace.
 */
export type AutoConfigDecision =
    | 'auto-run'
    | 'prompt'
    | 'prompt-install'
    | 'skip-no-language-support'
    | 'skip';

/**
 * Pure decision: should Jaenvtix auto-run, prompt, or stay quiet for this
 * workspace?
 *
 * Business rules:
 * - With no workspace folders, there is nothing to configure → `'skip'`.
 * - Nothing is configured while Java language support is missing, not even
 *   silently. What Jaenvtix writes is consumed by the Red Hat Java extension;
 *   without it a run would report success over an environment where nothing
 *   works. So "Always" with no language server is
 *   `'skip-no-language-support'`, which the caller logs. It is checked BEFORE
 *   `'auto-run'` and never prompts: "Always" means "stop asking me", and
 *   breaking that silence to request an install is the permission escalation
 *   this design rejects.
 * - The global "Always" preference (`alwaysAccepted === true`) otherwise takes
 *   priority over per-workspace state. If the user explicitly opted in
 *   globally, every workspace with a pom auto-runs without prompting.
 *   Workspace-local "No" answers from before the global opt-in are
 *   superseded.
 * - If "Always" is not set and the workspace already has a definitive
 *   answer (Yes or No, encoded as `dismissed === true`), respect it and
 *   `'skip'`. The user can re-run via the Command Palette.
 * - A workspace still owed a question gets `'prompt-install'` when language
 *   support is missing, `'prompt'` otherwise.
 */
export function decideAutoConfigAction(
    workspaceFolders: readonly {uri: {fsPath: string}}[] | undefined,
    workspaceDismissed: unknown,
    alwaysAccepted: unknown,
    languageServerInstalled: boolean,
): AutoConfigDecision {
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return 'skip';
    }

    if (alwaysAccepted === true) {
        return languageServerInstalled ? 'auto-run' : 'skip-no-language-support';
    }

    if (workspaceDismissed === true) {
        return 'skip';
    }

    return languageServerInstalled ? 'prompt' : 'prompt-install';
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
