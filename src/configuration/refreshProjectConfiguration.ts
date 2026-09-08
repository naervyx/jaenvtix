import {DEFAULT_CONCURRENCY_LIMIT, mapWithConcurrency} from '../util/concurrencyPool';

export type ProjectRefresher = (pomPath: string) => Promise<void>;

export interface RefreshSummary {
    succeeded: number;
    failed: number;
}

/**
 * Asks `refresher` to reload every project pom, keeping a bounded number of
 * requests in flight.

 * Business rules:
 * - Each pom path is presented to the refresher exactly once.
 * - Requests run concurrently (pool of `concurrency`): each call just
 *   enqueues an import job inside JDT, which m2e serializes internally, so
 *   issuing them one-by-one would only add idle round-trips in monorepos.
 * - A failure on any single pom does NOT affect the others; isolation per
 *   pom is preserved. This is critical because the Red Hat Language Server
 *   may not be installed (in which case every call rejects), and we don't
 *   want the Jaenvtix configuration step to fail noisily for a cooperative
 *   feature.
 * - The summary reports successes and failures so callers can decide
 *   whether to surface anything to the user.
 *
 * Pure with respect to the VS Code API: the caller wires the actual
 * `vscode.commands.executeCommand("java.projectConfiguration.update", ...)`
 * call, which keeps this module testable.
 */
export async function refreshAllProjects(
    pomPaths: readonly string[],
    refresher: ProjectRefresher,
    concurrency: number = DEFAULT_CONCURRENCY_LIMIT,
): Promise<RefreshSummary> {
    const settled = await mapWithConcurrency(pomPaths, concurrency, (pomPath) => refresher(pomPath));
    const succeeded = settled.filter((result) => result.status === 'fulfilled').length;

    return {succeeded, failed: settled.length - succeeded};
}
