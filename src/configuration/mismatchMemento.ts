/**
 * workspaceState key holding the absolute paths of projects whose last
 * verification ended in a compliance mismatch.
 *
 * PERSISTENCE CONTRACT: renaming this key silently drops every user's
 * recorded backlog (same class of contract as the auto-config prompt keys in
 * `activation/autoConfigPrompt.ts`). Choose once, keep forever.
 */
export const LAST_VERIFICATION_MISMATCH_KEY = 'jaenvtix.lastVerificationMismatch';

/**
 * Narrow view over `vscode.Memento` so this module (and the steps that
 * consume the accessor) never import `vscode` and stay testable under plain
 * Node. `vscode.ExtensionContext.workspaceState` satisfies it structurally.
 */
export interface MementoLike {
    get(key: string): unknown;
    update(key: string, value: unknown): unknown;
}

/**
 * Read/write access to the mismatch backlog, threaded from `activate()`
 * (the only place that has an `ExtensionContext`) down to the pipeline steps.
 */
export interface MismatchMementoAccessor {
    /** Project paths flagged by the previous run; empty when none. */
    get(): readonly string[];
    /** Replaces the backlog; an empty list clears the key entirely. */
    update(projectPaths: readonly string[]): Promise<void>;
}

/**
 * Validates a raw memento value into a mismatch backlog. Anything that is
 * not an array of strings (older versions, manual edits, corruption)
 * degrades to an empty backlog instead of breaking the pipeline.
 */
export function readMismatchBacklog(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** Binds the backlog contract to a concrete memento (workspaceState). */
export function createMismatchMemento(memento: MementoLike): MismatchMementoAccessor {
    return {
        get(): readonly string[] {
            return readMismatchBacklog(memento.get(LAST_VERIFICATION_MISMATCH_KEY));
        },
        async update(projectPaths: readonly string[]): Promise<void> {
            // `undefined` removes the key: an empty backlog should leave no
            // residue in the user's workspace storage.
            await memento.update(
                LAST_VERIFICATION_MISMATCH_KEY,
                projectPaths.length > 0 ? [...projectPaths] : undefined,
            );
        },
    };
}
