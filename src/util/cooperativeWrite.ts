import {log} from './logger';

/**
 * Performs one write into a setting another extension owns, and reports
 * whether it landed.
 *
 * Jaenvtix provisions settings that the official Java extensions register, and
 * none of those extensions is a hard dependency: `package.json` declares no
 * `extensionDependencies`, so the pack can be installed partially or not at
 * all. `WorkspaceConfiguration.update` throws for a setting no installed
 * extension registered ("Unable to write to User Settings because X is not a
 * registered configuration"), and `runStep` turns a thrown step into
 * `StepResult.error`, which short-circuits the rest of the pipeline. A setting
 * nobody registered also has no consumer, so losing that one write costs the
 * user nothing while aborting the run costs them every later step.
 *
 * The failure is therefore logged through `describeFailure` and swallowed.
 * Returns `true` only when the write landed, so callers log their own success
 * line only when something actually changed.
 */
export async function writeCooperatively(
    write: () => Thenable<void>,
    describeFailure: (detail: string) => string,
): Promise<boolean> {
    try {
        await write();
        return true;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(describeFailure(detail));
        return false;
    }
}
