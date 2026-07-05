/**
 * Outcome of waiting for the Red Hat Java Language Server to become ready.
 *
 * - `ready` — the server confirmed initialization; project-level commands
 *   (`java.projectConfiguration.update`, `java.project.getSettings`) are safe.
 * - `timeout` — the server is still loading. The `becameReady` promise stays
 *   live so the caller can resume deferred work once the server finishes,
 *   instead of acting on stale state now.
 * - `unconfirmed` — the extension is installed but readiness can never be
 *   confirmed (activation failure, an API version that predates
 *   `serverReady`, or a rejected readiness promise). Callers should attempt
 *   their commands best-effort, matching Jaenvtix's pre-gate behaviour.
 * - `extension-missing` — the Red Hat extension is not installed; there is no
 *   Language Server to talk to, so dependent commands should be skipped.
 * - `lightweight` — the user runs the server in LightWeight mode
 *   (`java.server.launchMode`). The Standard server never starts, so there is
 *   no resolved project configuration to refresh or verify. This is the
 *   user's deliberate choice: dependent work is a correct no-op, not a gap.
 */
export type ServerReadyOutcome = 'ready' | 'timeout' | 'unconfirmed' | 'extension-missing' | 'lightweight';

/**
 * Result of one wait attempt. `becameReady` is present only for `timeout`:
 * it resolves when the still-loading server eventually finishes, and never
 * settles if the server fails — so a detached continuation chained on it
 * either runs with a genuinely ready server or not at all.
 */
export interface ServerReadyWait {
    outcome: ServerReadyOutcome;
    becameReady?: Promise<void>;
}

/**
 * Resolves the activated exports of the `redhat.java` extension, or
 * `undefined` when the extension is not installed. The orchestrator wires
 * this to `vscode.extensions.getExtension('redhat.java')?.activate()`; tests
 * inject fakes.
 */
export type RedhatApiResolver = () => Promise<unknown>;

/**
 * How long to wait for `serverReady` before letting the pipeline finish.
 * The promise resolves once jdt.ls finishes initializing — normally seconds.
 * A timeout is not a dead end: the caller arms a continuation on
 * `becameReady`, so the cap only bounds how long the progress notification
 * stays visible, not whether the deferred work eventually happens.
 */
export const DEFAULT_SERVER_READY_TIMEOUT_MS = 15_000;

/**
 * Waits for the Red Hat Java Language Server to signal readiness via the
 * `serverReady()` promise of its public extension API (available since API
 * version 0.7).
 *
 * Business rules:
 * - Extension absent (`resolveApi` yields `undefined`/`null`) → `extension-missing`.
 * - `serverMode === 'LightWeight'` → `lightweight` immediately (no wait); the
 *   Standard server will never start, so waiting would always time out.
 * - Activation failure, missing/non-callable `serverReady`, or rejection →
 *   `unconfirmed`; the caller proceeds exactly as Jaenvtix did before this
 *   gate existed (attempt and swallow failures).
 * - `serverReady()` resolving within `timeoutMs` → `ready`.
 * - `timeoutMs` elapsing first → `timeout` + a live `becameReady` promise for
 *   the caller's continuation. Never gives up based on the clock alone.
 */
export async function waitForRedhatServerReady(
    resolveApi: RedhatApiResolver,
    timeoutMs: number = DEFAULT_SERVER_READY_TIMEOUT_MS,
): Promise<ServerReadyWait> {
    let api: unknown;
    try {
        api = await resolveApi();
    } catch {
        return {outcome: 'unconfirmed'};
    }

    if (api === undefined || api === null) {
        return {outcome: 'extension-missing'};
    }

    const apiRecord = api as Record<string, unknown>;
    if (apiRecord.serverMode === 'LightWeight') {
        return {outcome: 'lightweight'};
    }

    const serverReady = apiRecord.serverReady;
    if (typeof serverReady !== 'function') {
        return {outcome: 'unconfirmed'};
    }

    let readyPromise: Promise<unknown>;
    try {
        readyPromise = Promise.resolve(serverReady.call(api));
    } catch {
        return {outcome: 'unconfirmed'};
    }

    let timer: NodeJS.Timeout | undefined;
    try {
        const timedOut = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const settled = readyPromise.then(
            () => 'ready' as const,
            () => 'unconfirmed' as const,
        );
        const winner = await Promise.race([settled, timedOut]);

        if (winner !== 'timeout') {
            return {outcome: winner};
        }

        // Keep the live readiness signal for the post-run continuation. A
        // late rejection parks the promise forever: the continuation must
        // not fire against a failed server, and an unhandled rejection must
        // not escape to the extension host.
        const becameReady = new Promise<void>((resolve) => {
            readyPromise.then(() => resolve(), () => { /* server failed; continuation never fires */ });
        });
        return {outcome: 'timeout', becameReady};
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
