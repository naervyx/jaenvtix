/**
 * Possible decisions about whether (and how) to engage the user when a
 * workspace with `pom.xml` is opened:
 *
 * - `'prompt'`: ask the user with the two-option message ("Yes" / "No").
 * - `'prompt-install'`: same moment, but Java language support is missing, so
 *   the two-option message offering to install it first is shown instead.
 * - `'skip'`: stay quiet.
 *
 * There is deliberately no silent path, and no global opt-in. One was tried
 * ("Always") and removed: it produced a state nobody could see or escape from,
 * where a workspace with no Java language support was neither configured
 * (nothing would consume the settings) nor offered the install (the preference
 * said stop asking).
 */
export type AutoConfigDecision =
    | 'prompt'
    | 'prompt-install'
    | 'skip';

/**
 * What the user said about a workspace.
 *
 * - `'accepted'`: they asked for it to be configured, by answering the prompt
 *   or by running the command themselves.
 * - `'declined'`: they said no. Permanent for that workspace, and the only
 *   thing that outranks "this project is not configured". Without it, someone
 *   who deliberately keeps `.vscode` out of their repository would be asked on
 *   every single open.
 */
export type AutoConfigAnswer = 'accepted' | 'declined';

/**
 * What gets persisted under `AUTO_CONFIG_RECORD_KEY` once a workspace answers.
 *
 * `configured` lists the `settings.json` files the pipeline wrote, one per
 * resolved project, recorded on every successful run even when the writers
 * changed nothing. It is what makes "is this project still configured?"
 * answerable with a handful of `stat` calls instead of a directory scan.
 *
 * `generation` records the reset generation in force at the time, so a later
 * global reset can invalidate the record without reaching into other
 * workspaces' state (see `AUTO_CONFIG_GENERATION_KEY`).
 */
export interface AutoConfigRecord {
    answer: AutoConfigAnswer;
    generation: number;
    configured?: string[];
}

/**
 * Reads whatever is in `workspaceState` and returns a usable record, or
 * `undefined` for "this workspace has never answered".
 *
 * Business rules:
 * - The literal `true` is the earlier shape, written before the answer's
 *   polarity was recorded. It reads as `'accepted'` with no `configured`
 *   list: those workspaces fall back to probing the filesystem, which is what
 *   lets a previously answered but now unconfigured project be offered again.
 *   Reading it as `'declined'` would be the worse mistake, since that silences
 *   a workspace forever on a guess.
 * - Anything unrecognized counts as "never answered". Corrupted or
 *   half-migrated state must fail towards asking, never towards a silence the
 *   user has no way to escape.
 */
export function normalizeRecord(raw: unknown): AutoConfigRecord | undefined {
    if (raw === true) {
        return {answer: 'accepted', generation: 0};
    }

    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }

    const {answer, generation, configured} = raw as Partial<AutoConfigRecord>;
    if (answer !== 'accepted' && answer !== 'declined') {
        return undefined;
    }

    const paths = Array.isArray(configured) && configured.every((entry) => typeof entry === 'string' && entry.length > 0)
        ? configured
        : undefined;

    return {answer, generation: normalizeGeneration(generation), configured: paths};
}

/**
 * Coerces a persisted reset generation to a usable counter. Anything that is
 * not a finite, non-negative number reads as `0`, the generation every record
 * written before the counter existed is treated as carrying.
 */
export function normalizeGeneration(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        return 0;
    }
    return Math.floor(raw);
}

/**
 * Pure decision: should Jaenvtix ask, ask about installing, or stay quiet for
 * this workspace?
 *
 * Business rules, in precedence order:
 * 1. No workspace folders means nothing to configure → `'skip'`.
 * 2. A record older than the current reset generation is ignored and the
 *    question is asked again. This outranks even `workspaceConfigured`:
 *    `jaenvtix.resetAutoConfigPreference` exists to be asked again, so a
 *    configured project must not silently swallow it.
 * 3. `'declined'` wins over everything below. The user said no to this
 *    workspace and gets to keep that answer, configured or not.
 * 4. A configured workspace is left alone. This is the common case.
 * 5. Otherwise the question is live. **The trigger is the state of the
 *    project, not whether the user was once asked.** A project with a pom and
 *    no configuration needs configuring, whatever was answered in the past;
 *    anchoring on "already answered" is what let a workspace go permanently
 *    silent while genuinely broken.
 *
 * Which question gets asked is decided by the environment right now, never by
 * history: no language server means `'prompt-install'`, otherwise `'prompt'`.
 */
export function decideAutoConfigAction(
    workspaceFolders: readonly {uri: {fsPath: string}}[] | undefined,
    workspaceRecord: unknown,
    languageServerInstalled: boolean,
    workspaceConfigured: boolean,
    currentGeneration: unknown = 0,
): AutoConfigDecision {
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return 'skip';
    }

    const ask = (): AutoConfigDecision => (languageServerInstalled ? 'prompt' : 'prompt-install');
    const record = normalizeRecord(workspaceRecord);

    if (record !== undefined && record.generation < normalizeGeneration(currentGeneration)) {
        return ask();
    }

    if (record?.answer === 'declined') {
        return 'skip';
    }

    return workspaceConfigured ? 'skip' : ask();
}

/**
 * Workspace-state key — holds the `AutoConfigRecord` for this workspace. The
 * literal string is part of the persistence contract: changing it would forget
 * every existing answer and ask every user once more.
 */
export const AUTO_CONFIG_RECORD_KEY = 'jaenvtix.autoConfigPromptDismissed';

/**
 * Global-state key — a counter bumped by
 * `jaenvtix.resetAutoConfigPreference`. Every workspace stamps the generation
 * in force when it answered; a record older than the current generation is
 * ignored, so one command resets every workspace at once.
 *
 * This exists because `workspaceState` is reachable only for the workspace
 * currently open. Bumping a global counter is the only way, using public API,
 * to invalidate answers recorded elsewhere. Those rows stay in the host's
 * storage; they simply stop counting.
 */
export const AUTO_CONFIG_GENERATION_KEY = 'jaenvtix.autoConfigGeneration';
