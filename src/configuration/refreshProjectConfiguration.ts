export type ProjectRefresher = (pomPath: string) => Promise<void>;

export interface RefreshSummary {
    succeeded: number;
    failed: number;
}

/**
 * Sequentially asks `refresher` to reload every project pom.
 *
 * Business rules:
 * - Each pom path is presented to the refresher exactly once, in order.
 * - A failure on any single pom does NOT abort the loop — the next pom is
 *   still attempted. This is critical because the Red Hat Language Server
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
    refresher: ProjectRefresher
): Promise<RefreshSummary> {
    let succeeded = 0;
    let failed = 0;

    for (const pomPath of pomPaths) {
        try {
            await refresher(pomPath);
            succeeded++;
        } catch {
            failed++;
        }
    }

    return {succeeded, failed};
}
