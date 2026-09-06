import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    installLanguageSupport,
    InstallLanguageSupportDeps,
    JAVA_EXTENSION_PACK_ID,
    JAVA_LANGUAGE_SERVER_ID,
} from '../../src/activation/installLanguageSupport';
import {setLogSink} from '../../src/util/logger';

/**
 * In-memory stand-in for the extension host. `visibleAfter` is how many
 * visibility checks must happen before `redhat.java` shows up, which models the
 * host publishing a freshly installed extension; `Infinity` never publishes it.
 */
function makeDeps(options: {
    visibleAfter?: number;
    rejectInstall?: boolean;
} = {}): {calls: string[]; waits: number; deps: InstallLanguageSupportDeps} {
    const calls: string[] = [];
    const state = {checks: 0, waits: 0};
    const visibleAfter = options.visibleAfter ?? 0;

    const deps: InstallLanguageSupportDeps = {
        isLanguageServerVisible: () => {
            const visible = state.checks >= visibleAfter;
            state.checks += 1;
            return visible;
        },
        installExtensionPack: async () => {
            calls.push('install');
            if (options.rejectInstall) {
                throw new Error('Extension not found in the marketplace.');
            }
        },
        withProgress: async (title, task) => {
            calls.push(`progress:${title}`);
            await task();
        },
        waitForExtensionChange: async () => { state.waits += 1; },
    };

    return {calls, get waits() { return state.waits; }, deps};
}

const silenceLog = () => setLogSink(() => { /* captured by the test, not printed */ });

afterEach(() => {
    setLogSink((message) => console.log(message));
});

describe('installLanguageSupport', () => {
    it("reports 'ready' when the language server is visible right after the install", async () => {
        silenceLog();
        const {calls, deps} = makeDeps({visibleAfter: 0});

        const outcome = await installLanguageSupport(deps);

        assert.equal(outcome, 'ready');
        assert.deepEqual(calls, ['progress:Jaenvtix: Installing Extension Pack for Java', 'install']);
    });

    it('runs the install inside the progress notification, not beside it', async () => {
        silenceLog();
        const {calls, deps} = makeDeps();

        await installLanguageSupport(deps);

        // The progress wrapper must open before the install starts, otherwise
        // the user stares at nothing for the length of the download.
        assert.ok(calls.indexOf('progress:Jaenvtix: Installing Extension Pack for Java') < calls.indexOf('install'));
    });

    it('waits for the host to publish the extension when it is not visible yet', async () => {
        silenceLog();
        const harness = makeDeps({visibleAfter: 3});

        const outcome = await installLanguageSupport(harness.deps);

        assert.equal(outcome, 'ready');
        assert.ok(harness.waits > 0, 'expected the safety-net wait to run at least once');
    });

    it("reports 'unavailable' when the extension never becomes visible", async () => {
        silenceLog();
        const harness = makeDeps({visibleAfter: Infinity});

        const outcome = await installLanguageSupport(harness.deps);

        assert.equal(outcome, 'unavailable');
        // The budget is bounded: it must not spin forever.
        assert.ok(harness.waits <= 20, `safety net ran ${harness.waits} times, expected a bounded budget`);
    });

    it("reports 'unavailable' without throwing when the install is rejected", async () => {
        // Host with no access to these extensions, offline, or a blocked proxy.
        // The caller decides what the user sees; an unhandled rejection at
        // activation time helps nobody.
        silenceLog();
        const {deps} = makeDeps({visibleAfter: Infinity, rejectInstall: true});

        const outcome = await installLanguageSupport(deps);

        assert.equal(outcome, 'unavailable');
    });

    it("still reports 'ready' when the install rejects but the extension is already there", async () => {
        // Installing something already installed can reject on some hosts. What
        // matters is the end state, not the command's verdict.
        silenceLog();
        const {deps} = makeDeps({visibleAfter: 0, rejectInstall: true});

        assert.equal(await installLanguageSupport(deps), 'ready');
    });

    it('logs the refusal instead of swallowing it silently', async () => {
        const lines: string[] = [];
        setLogSink((message) => { lines.push(message); });
        const {deps} = makeDeps({visibleAfter: Infinity, rejectInstall: true});

        await installLanguageSupport(deps);

        assert.ok(
            lines.some((line) => line.includes('Extension not found in the marketplace.')),
            `expected the install failure in the log, got: ${JSON.stringify(lines)}`,
        );
        assert.ok(lines.some((line) => line.includes(JAVA_LANGUAGE_SERVER_ID)));
    });

    it('targets the pack for install and the language server for the visibility gate', () => {
        // The gate must never be the pack: a pack contributes no settings and
        // can be installed with members missing.
        assert.equal(JAVA_EXTENSION_PACK_ID, 'vscjava.vscode-java-pack');
        assert.equal(JAVA_LANGUAGE_SERVER_ID, 'redhat.java');
    });
});
