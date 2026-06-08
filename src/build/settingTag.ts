import {dirname, posix, win32} from 'node:path';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {cpus} from 'node:os';
import {Messages} from '../util/message';
import type {PlatformType} from '../core/system';

type TerminalEnv = Record<string, string>;

interface MavenTerminalEnvEntry {
    environmentVariable: string;
    value: string;
}

interface VsCodeSettings {
    "java.jdt.ls.java.home"?: string;
    "java.jdt.ls.lombokSupport.enabled"?: boolean;
    "maven.executable.preferMavenWrapper"?: boolean;
    "maven.executable.path"?: string;
    "maven.terminal.customEnv"?: MavenTerminalEnvEntry[];
    "java.compile.nullAnalysis.mode"?: string;
    "java.configuration.updateBuildConfiguration"?: string;
    "java.configuration.maven.userSettings"?: string;
    "java.configuration.runtimes"?: JavaRuntime[];
    "terminal.integrated.env.windows"?: TerminalEnv;
    "terminal.integrated.env.linux"?: TerminalEnv;
    "terminal.integrated.env.osx"?: TerminalEnv;
    [key: string]: unknown;
}

/**
 * All path and platform inputs required to generate the VS Code per-folder
 * `settings.json` entries for a single project at a specific Java version.
 */
interface JavaMavenPaths {
    /**
     * Absolute path to the JDK used by jdt.ls (`java.jdt.ls.java.home`).
     * Omitted for Java 21+ projects because jdt.ls ships its own JDK and
     * the key should not be written (avoids overriding the bundled tooling JDK).
     */
    javaHomePath?: string;
    /**
     * Entries for `java.configuration.runtimes`. Written only for Java < 21
     * projects; omitted (and the key removed) when empty.
     */
    runtimes?: JavaRuntime[];
    /** Absolute path to the JDK used in terminal environments and Maven invocations. */
    terminalJavaHome: string;
    mavenHomePath: string;
    mavenBinPath: string;
    /**
     * Path to the Jaenvtix Maven wrapper script.
     *
     * When defined (project does NOT ship `mvnw`), Jaenvtix points
     * `maven.executable.path` to it and disables vscode-maven's preference
     * for the in-project wrapper.
     *
     * When undefined (project ships `mvnw`), Jaenvtix yields to the
     * project's wrapper: it leaves `maven.executable.path` unset and keeps
     * `maven.executable.preferMavenWrapper: true` so vscode-maven picks
     * `mvnw`/`mvnw.cmd` from the project root. JAVA_HOME still flows
     * through `terminal.integrated.env.*`.
     */
    mavenExecutablePath?: string;
    userSettingsPath: string;
    platform: PlatformType;
}

interface JavaRuntime {
    name: string;
    path: string;
    default?: boolean;
}

interface UpdateResult {
    updated: boolean;
    updatedKeys: string[];
}

function isRecord(value: unknown): value is Record<string, string> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveTerminalEnvKey(platform: PlatformType): keyof VsCodeSettings {
    if (platform === 'windows') {
        return 'terminal.integrated.env.windows';
    }

    if (platform === 'darwin') {
        return 'terminal.integrated.env.osx';
    }

    return 'terminal.integrated.env.linux';
}

function getPathVariableName(platform: PlatformType, existingEnv?: TerminalEnv): string {
    if (platform !== 'windows') {
        return 'PATH';
    }

    if (existingEnv && 'PATH' in existingEnv) {
        return 'PATH';
    }

    return 'Path';
}

function buildTerminalEnvUpdates(paths: JavaMavenPaths, existingEnv?: TerminalEnv): TerminalEnv {
    const pathJoin = paths.platform === 'windows' ? win32.join : posix.join;
    const javaBinPath = pathJoin(paths.terminalJavaHome, 'bin');
    const pathKey = getPathVariableName(paths.platform, existingEnv);
    const pathDelimiter = paths.platform === 'windows' ? ';' : ':';
    const envPathRef = pathKey === 'PATH' ? '${env:PATH}' : '${env:Path}';
    const combinedPath = `${javaBinPath}${pathDelimiter}${paths.mavenBinPath}${pathDelimiter}${envPathRef}`;

    return {
        JAVA_HOME: paths.terminalJavaHome,
        MAVEN_HOME: paths.mavenHomePath,
        M2_HOME: paths.mavenHomePath,
        [pathKey]: combinedPath,
    };
}

function mergeTerminalEnv(existing: unknown, updates: TerminalEnv): { merged: TerminalEnv; updated: boolean } {
    const existingEnv = isRecord(existing) ? existing as TerminalEnv : {};
    const merged: TerminalEnv = { ...existingEnv };
    let updated = !isRecord(existing);

    for (const [key, value] of Object.entries(updates)) {
        if (merged[key] !== value) {
            merged[key] = value;
            updated = true;
        }
    }

    return { merged, updated };
}

/**
 * Builds the `maven.terminal.customEnv` entries vscode-maven applies to its
 * own terminal. Unlike `terminal.integrated.env.*` (which the VS Code core
 * applies to every terminal opened in the folder), `maven.terminal.customEnv`
 * is consumed specifically by the Maven Explorer terminal of vscode-maven.
 *
 * Both are written: the core env handles user-opened terminals; this one
 * handles the Maven Explorer flow. They reinforce each other and keep the
 * per-folder JAVA_HOME explicit/auditable in either path.
 */
function buildMavenCustomEnv(paths: JavaMavenPaths): MavenTerminalEnvEntry[] {
    const pathJoin = paths.platform === 'windows' ? win32.join : posix.join;
    const javaBinPath = pathJoin(paths.terminalJavaHome, 'bin');
    const pathDelimiter = paths.platform === 'windows' ? ';' : ':';
    const combinedPath = `${javaBinPath}${pathDelimiter}${paths.mavenBinPath}${pathDelimiter}\${env:PATH}`;

    return [
        {environmentVariable: 'JAVA_HOME', value: paths.terminalJavaHome},
        {environmentVariable: 'MAVEN_HOME', value: paths.mavenHomePath},
        {environmentVariable: 'M2_HOME', value: paths.mavenHomePath},
        {environmentVariable: 'PATH', value: combinedPath},
    ];
}

function isMavenCustomEnvArray(value: unknown): value is MavenTerminalEnvEntry[] {
    if (!Array.isArray(value)) {return false;}
    return value.every((entry) =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as MavenTerminalEnvEntry).environmentVariable === 'string' &&
        typeof (entry as MavenTerminalEnvEntry).value === 'string'
    );
}

/**
 * Non-destructive merge of `maven.terminal.customEnv`.
 *
 * Business rules:
 * - Existing entries with an `environmentVariable` Jaenvtix doesn't manage
 *   are preserved verbatim (the user may have added their own).
 * - Existing entries that DO collide on `environmentVariable` are updated
 *   in place — same env var, new value.
 * - Order of pre-existing entries is preserved; new managed entries are
 *   appended after them.
 */
function mergeMavenCustomEnv(
    existing: unknown,
    updates: readonly MavenTerminalEnvEntry[]
): { merged: MavenTerminalEnvEntry[]; updated: boolean } {
    const existingEntries = isMavenCustomEnvArray(existing) ? existing : [];
    const updatesByKey = new Map(updates.map((entry) => [entry.environmentVariable, entry.value]));
    const merged: MavenTerminalEnvEntry[] = [];
    let updated = !isMavenCustomEnvArray(existing);

    for (const entry of existingEntries) {
        const newValue = updatesByKey.get(entry.environmentVariable);
        if (typeof newValue === 'string') {
            if (newValue !== entry.value) {
                merged.push({environmentVariable: entry.environmentVariable, value: newValue});
                updated = true;
            } else {
                merged.push({environmentVariable: entry.environmentVariable, value: entry.value});
            }
            updatesByKey.delete(entry.environmentVariable);
            continue;
        }

        merged.push({environmentVariable: entry.environmentVariable, value: entry.value});
    }

    for (const [environmentVariable, value] of updatesByKey) {
        merged.push({environmentVariable, value});
        updated = true;
    }

    return {merged, updated};
}

/**
 * Writes or updates the VS Code per-folder `settings.json` at `settingsPath`
 * with Java and Maven configuration derived from `paths`.
 *
 * Business rules:
 * - Always writes: `java.jdt.ls.lombokSupport.enabled`, `java.compile.nullAnalysis.mode`,
 *   `java.configuration.updateBuildConfiguration`, `java.configuration.maven.userSettings`.
 * - Writes `java.jdt.ls.java.home` only for Java < 21; omits (and removes) it for
 *   Java 21+ where jdt.ls manages its own tooling JDK.
 * - When the project does NOT ship `mvnw`: writes `maven.executable.path` and sets
 *   `maven.executable.preferMavenWrapper: false` to prevent vscode-maven from
 *   searching for a non-existent wrapper. Also writes `maven.terminal.customEnv`.
 * - When the project DOES ship `mvnw`: removes both `maven.executable.*` keys and
 *   `maven.terminal.customEnv` — vscode-maven's defaults handle the wrapper.
 *   JAVA_HOME is still injected via `terminal.integrated.env.*`.
 * - Terminal env (`terminal.integrated.env.linux/windows/osx`) is merged
 *   non-destructively: existing user-defined keys are preserved; managed keys
 *   (`JAVA_HOME`, `MAVEN_HOME`, `M2_HOME`, `PATH`/`Path`) are updated.
 * - Recovers from malformed JSON by resetting to an empty settings object.
 * - Creates `.vscode/` if it does not exist.
 * - Returns `updated: false` when nothing changed (safe to re-run).
 */
/**
 * Writes sensible Java defaults into a plain settings object without overwriting
 * keys that are already present (`setIfUndefined` semantics). Pass `osPlatform`
 * explicitly in tests to control which platform-specific tunings are applied.
 */
export function applyUserJavaTunings(
    data: VsCodeSettings,
    osPlatform: string = process.platform,
): VsCodeSettings {
    const result = {...data};
    setIfUndefined(result, 'java.debug.settings.hotCodeReplace', 'auto');
    setIfUndefined(result, 'java.maxConcurrentBuilds', Math.max(1, cpus().length - 1));
    setIfUndefined(result, 'java.dependency.packagePresentation', 'hierarchical');
    setIfUndefined(result, 'java.sources.organizeImports.staticStarThreshold', 1);
    if (osPlatform === 'win32') {
        setIfUndefined(result, 'java.test.config', [{vmArgs: ['-Dfile.encoding=UTF-8']}]);
    }
    return result;
}

function setIfUndefined<T>(obj: Record<string, unknown>, key: string, value: T): void {
    if (obj[key] === undefined) {obj[key] = value;}
}

export function updateVsCodeSettings(
    settingsPath: string,
    paths: JavaMavenPaths
): UpdateResult {
    const result: UpdateResult = {
        updated: false,
        updatedKeys: []
    };

    let data: VsCodeSettings = {};
    
    if (existsSync(settingsPath)) {
        const fileContent = readFileSync(settingsPath, 'utf-8');
        try {
            data = JSON.parse(fileContent) as VsCodeSettings;
        } catch {
            console.error(Messages.Error.SETTINGS_PARSE_FAILED);
            data = {};
        }
    }

    // When the project ships `mvnw`, Jaenvtix yields to it: omit
    // `maven.executable.path` AND `maven.executable.preferMavenWrapper`
    // entirely — vscode-maven's default (`preferMavenWrapper: true`) already
    // does the right thing, so writing redundant keys would be noise.
    // When there is no mvnw, point at the Jaenvtix wrapper and explicitly
    // disable vscode-maven's wrapper preference (otherwise it would search
    // for a non-existent `mvnw`).
    const respectMvnw = typeof paths.mavenExecutablePath === 'undefined';

    const requiredSettings: Record<string, unknown> = {
        "java.jdt.ls.java.home": paths.javaHomePath,
        "java.jdt.ls.lombokSupport.enabled": true,
        "maven.executable.preferMavenWrapper": respectMvnw ? undefined : false,
        "maven.executable.path": paths.mavenExecutablePath,
        "java.compile.nullAnalysis.mode": "automatic",
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.configuration.maven.userSettings": paths.userSettingsPath,
    };

    for (const [key, value] of Object.entries(requiredSettings)) {
        if (typeof value === 'undefined') {
            if (key in data) {
                delete data[key];
                result.updatedKeys.push(key);
                result.updated = true;
            }
            continue;
        }

        if (!Object.is(data[key], value)) {
            data[key] = value;
            result.updatedKeys.push(key);
            result.updated = true;
        }
    }

    const runtimesKey = 'java.configuration.runtimes';
    if (!paths.runtimes || paths.runtimes.length === 0) {
        if (runtimesKey in data) {
            delete data[runtimesKey];
            result.updatedKeys.push(runtimesKey);
            result.updated = true;
        }
    } else {
        const existingRuntimes = data[runtimesKey];
        const isSameRuntime =
            Array.isArray(existingRuntimes) &&
            existingRuntimes.length === paths.runtimes.length &&
            existingRuntimes.every((entry, index) => {
                const runtimeEntry = entry as Partial<JavaRuntime>;
                const nextEntry = paths.runtimes?.[index];
                return Boolean(nextEntry) &&
                    runtimeEntry.name === nextEntry?.name &&
                    runtimeEntry.path === nextEntry?.path &&
                    Boolean(runtimeEntry.default) === Boolean(nextEntry?.default);
            });

        if (!isSameRuntime) {
            data[runtimesKey] = paths.runtimes;
            result.updatedKeys.push(runtimesKey);
            result.updated = true;
        }
    }

    const terminalEnvKey = resolveTerminalEnvKey(paths.platform);
    const existingTerminalEnv = isRecord(data[terminalEnvKey]) ? data[terminalEnvKey] as TerminalEnv : undefined;
    const terminalEnvUpdates = buildTerminalEnvUpdates(paths, existingTerminalEnv);
    const { merged: mergedTerminalEnv, updated: terminalEnvUpdated } = mergeTerminalEnv(
        data[terminalEnvKey],
        terminalEnvUpdates
    );

    if (terminalEnvUpdated) {
        data[terminalEnvKey] = mergedTerminalEnv;
        result.updatedKeys.push(String(terminalEnvKey));
        result.updated = true;
    }

    const customEnvKey = 'maven.terminal.customEnv';
    if (respectMvnw) {
        // When the project drives Maven via its own mvnw, the env that vscode-maven
        // would inject via `customEnv` is already covered by `terminal.integrated.env.*`
        // (which the VS Code core applies to every terminal opened in the folder,
        // including the Maven Explorer one). Writing `customEnv` would be redundant
        // — drop the key if a previous run left it behind.
        if (customEnvKey in data) {
            delete data[customEnvKey];
            result.updatedKeys.push(customEnvKey);
            result.updated = true;
        }
    } else {
        const customEnvUpdates = buildMavenCustomEnv(paths);
        const { merged: mergedCustomEnv, updated: customEnvUpdated } = mergeMavenCustomEnv(
            data[customEnvKey],
            customEnvUpdates,
        );

        if (customEnvUpdated) {
            data[customEnvKey] = mergedCustomEnv;
            result.updatedKeys.push(customEnvKey);
            result.updated = true;
        }
    }

    if (result.updated) {
        const dirPath = dirname(settingsPath);
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
        }

        writeFileSync(settingsPath, JSON.stringify(data, null, 4), 'utf-8');
    }

    return result;
}
