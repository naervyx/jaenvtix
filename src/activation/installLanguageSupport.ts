import {log} from '../util/logger';
import {Messages} from '../util/message';

/**
 * Marketplace ID of the pack offered at activation. Installing it pulls in the
 * language server plus the debugger, test runner, Maven and dependency views.
 */
export const JAVA_EXTENSION_PACK_ID = 'vscjava.vscode-java-pack';

/**
 * The pack member that actually consumes what Jaenvtix provisions. Presence of
 * this member, never of the pack, is what decides whether configuring is
 * worthwhile: a pack contributes no settings of its own and can be installed
 * with members missing.
 */
export const JAVA_LANGUAGE_SERVER_ID = 'redhat.java';

/**
 * Safety net for the extension host to publish a freshly installed extension.
 *
 * Measured on 2026-09-05 (VS Code 1.136.0 and Cursor 3.19.7, Windows): the
 * member was already visible on the first check after `installExtension`
 * resolved, in both hosts. So awaiting the install IS the synchronization
 * point and this budget is not the expected path, only cover for a slower
 * machine or a host that behaves differently.
 */
const VISIBILITY_BUDGET_MS = 5_000;
const VISIBILITY_POLL_MS = 250;

/**
 * Minimal surface of the VS Code APIs this flow needs. `extension.ts` injects
 * the real implementations; tests inject in-memory fakes so the module never
 * imports `vscode` and stays loadable under plain Node.
 */
export interface InstallLanguageSupportDeps {
    /** True when `redhat.java` is visible to the extension host. */
    isLanguageServerVisible(): boolean;
    /** Runs `workbench.extensions.installExtension` for the pack. */
    installExtensionPack(): Thenable<void>;
    /** Wraps `task` in a progress notification titled `title`. */
    withProgress(title: string, task: () => Promise<void>): Thenable<void>;
    /** Resolves on the next extension-host change, or after `ms` elapse. */
    waitForExtensionChange(ms: number): Promise<void>;
}

/**
 * `'ready'`: language support is visible and the caller may configure.
 * `'unavailable'`: it is not, whatever the reason, and nothing may be written.
 */
export type InstallLanguageSupportOutcome = 'ready' | 'unavailable';

/**
 * Installs Java language support so the workspace can be configured, and
 * reports whether it worked.
 *
 * Business rules:
 * - All or nothing. The caller configures only on `'ready'`. Configuring
 *   without language support reports success over an environment where
 *   nothing works, which misleads more than doing nothing.
 * - One outcome for every failure. A rejected install, a host with no access
 *   to these extensions, a registration that needs a window reload, and an
 *   extension that is installed but disabled all produce `'unavailable'`. The
 *   API cannot tell them apart (`getExtension` does not see disabled
 *   extensions and there is no enable API), and the remedy the user needs is
 *   the same in all four.
 * - A rejected install is logged, never thrown: the caller decides what the
 *   user sees, and an unhandled rejection at activation helps nobody.
 * - No timeout of our own around the install. The same measurement clocked
 *   9.2s on VS Code and 161s on Cursor; cutting by the clock would abort an
 *   install that was going to succeed.
 */
export async function installLanguageSupport(
    deps: InstallLanguageSupportDeps,
): Promise<InstallLanguageSupportOutcome> {
    log(Messages.Log.EXTENSION_PACK_INSTALLING(JAVA_EXTENSION_PACK_ID));

    await deps.withProgress(Messages.Progress.INSTALL_LANGUAGE_SUPPORT_TITLE, async () => {
        try {
            await deps.installExtensionPack();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            log(Messages.Log.EXTENSION_PACK_INSTALL_FAILED(JAVA_EXTENSION_PACK_ID, detail));
        }
    });

    const attempts = Math.ceil(VISIBILITY_BUDGET_MS / VISIBILITY_POLL_MS);
    for (let attempt = 0; attempt < attempts && !deps.isLanguageServerVisible(); attempt += 1) {
        await deps.waitForExtensionChange(VISIBILITY_POLL_MS);
    }

    if (!deps.isLanguageServerVisible()) {
        log(Messages.Log.LANGUAGE_SERVER_STILL_ABSENT(JAVA_LANGUAGE_SERVER_ID));
        return 'unavailable';
    }

    log(Messages.Log.LANGUAGE_SERVER_READY(JAVA_LANGUAGE_SERVER_ID));
    return 'ready';
}
