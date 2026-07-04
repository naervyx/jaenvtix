/**
 * Outcome of waiting for the Red Hat Java Language Server to become ready.
 *
 * - `ready` — the server confirmed initialization; project-level commands
 *   (`java.projectConfiguration.update`, `java.project.getSettings`) are safe.
 * - `unconfirmed` — the extension is installed but readiness could not be
 *   confirmed (timeout, activation failure, or an API version that predates
 *   `serverReady`). Callers should still attempt their commands best-effort,
 *   matching Jaenvtix's pre-gate behaviour.
 * - `extension-missing` — the Red Hat extension is not installed; there is no
 *   Language Server to talk to, so dependent commands should be skipped.
 */
export type ServerReadyOutcome = 'ready' | 'unconfirmed' | 'extension-missing';

/**
 * Resolves the activated exports of the `redhat.java` extension, or
 * `undefined` when the extension is not installed. The orchestrator wires
 * this to `vscode.extensions.getExtension('redhat.java')?.activate()`; tests
 * inject fakes.
 */
export type RedhatApiResolver = () => Promise<unknown>;

/**
 * How long to wait for `serverReady` before proceeding best-effort. The
 * promise resolves once jdt.ls finishes initializing — normally seconds, not
 * minutes — so a longer wait would only prolong the progress notification
 * when the server is genuinely stuck.
 */
export const DEFAULT_SERVER_READY_TIMEOUT_MS = 60_000;

/**
 * Waits for the Red Hat Java Language Server to signal readiness via the
 * `serverReady()` promise of its public extension API (available since API
 * version 0.7).
 *
 * Business rules:
 * - Extension absent (`resolveApi` yields `undefined`/`null`) → `extension-missing`.
 * - Activation failure, missing/non-callable `serverReady`, rejection, or
 *   timeout → `unconfirmed`; the caller proceeds exactly as Jaenvtix did
 *   before this gate existed (attempt and swallow failures).
 * - `serverReady()` resolving within `timeoutMs` → `ready`.
 */
export async function waitForRedhatServerReady(
    resolveApi: RedhatApiResolver,
    timeoutMs: number = DEFAULT_SERVER_READY_TIMEOUT_MS,
): Promise<ServerReadyOutcome> {
    let api: unknown;
    try {
        api = await resolveApi();
    } catch {
        return 'unconfirmed';
    }

    if (api === undefined || api === null) {
        return 'extension-missing';
    }

    const serverReady = (api as Record<string, unknown>).serverReady;
    if (typeof serverReady !== 'function') {
        return 'unconfirmed';
    }

    let timer: NodeJS.Timeout | undefined;
    try {
        const timedOut = new Promise<'unconfirmed'>((resolve) => {
            timer = setTimeout(() => resolve('unconfirmed'), timeoutMs);
        });
        const ready = Promise.resolve(serverReady.call(api)).then(
            () => 'ready' as const,
            () => 'unconfirmed' as const,
        );
        return await Promise.race([ready, timedOut]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
