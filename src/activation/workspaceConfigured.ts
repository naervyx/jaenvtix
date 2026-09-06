import {existsSync, readFileSync} from 'node:fs';

import {buildVsCodeSettingPath} from '../build/directory';
import {AutoConfigRecord} from './autoConfigPrompt';

/**
 * Prefix that marks a `settings.json` as one Jaenvtix wrote. Only the
 * workspace-root project's file carries these (see `ConfigureSettingsStep`),
 * which is why the prefix probe is a fallback and never the primary check.
 */
const JAENVTIX_SETTING_PREFIX = 'jaenvtix.';

/**
 * Answers "is this workspace still configured?" for the activation decision.
 *
 * Business rules:
 * - **A recorded path list is the exact answer.** A successful run records the
 *   `settings.json` of every resolved project, so one missing file means the
 *   workspace lost its configuration and the question is live again. This is a
 *   handful of `stat` calls, never a directory scan: scanning at activation is
 *   the cost the `workspaceContains` fix exists to avoid.
 * - **Without a list, probe each workspace folder root.** Records written
 *   before the list existed have no paths, and a folder configured inside a
 *   multi-root workspace has no record at all when opened on its own, because
 *   the host keys `workspaceState` to the `.code-workspace` file. Probing for a
 *   `jaenvtix.*` key in the root `settings.json` keeps both cases quiet instead
 *   of asking about a project that is plainly already set up.
 * - An unreadable or malformed `settings.json` counts as not configured. The
 *   remedy for a broken settings file is to write it again, and the pipeline
 *   is non-destructive about the entries it does not own.
 * - No folders means not configured, though the caller decides `'skip'` on
 *   that before ever asking this.
 */
export function isWorkspaceConfigured(
    record: AutoConfigRecord | undefined,
    workspaceFolderPaths: readonly string[],
): boolean {
    if (workspaceFolderPaths.length === 0) {
        return false;
    }

    const recorded = record?.configured;
    if (recorded !== undefined && recorded.length > 0) {
        return recorded.every((settingsPath) => existsSync(settingsPath));
    }

    return workspaceFolderPaths.every((folderPath) => hasJaenvtixSettings(buildVsCodeSettingPath(folderPath)));
}

/** True when `settings.json` exists, parses, and carries a `jaenvtix.*` key. */
function hasJaenvtixSettings(settingsPath: string): boolean {
    if (!existsSync(settingsPath)) {
        return false;
    }

    try {
        const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null) {
            return false;
        }
        return Object.keys(parsed).some((key) => key.startsWith(JAENVTIX_SETTING_PREFIX));
    } catch {
        return false;
    }
}
