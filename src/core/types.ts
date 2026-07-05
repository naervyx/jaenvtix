import {DownloadResult} from '../file/fileDownload';
import {ArchitectureType, PlatformType} from './system';
import {MavenDistribution} from '../build/mavenUrl';
import type {ServerReadyWait} from '../configuration/serverReadyGate';

/**
 * Entry shape of VS Code's `java.configuration.runtimes` setting. Shared by
 * the per-project settings writer, the user-level runtimes merge, and the
 * steps that build candidate entries.
 */
export interface JavaRuntime {
    name: string;
    path: string;
    sources?: string;
    javadoc?: string;
    default?: boolean;
}

/**
 * All resolved information needed to apply VS Code settings for a single
 * Maven project at a specific Java version. One `ProjectContext` is produced
 * per (project × Java version) combination by `BuildProjectContextsStep`.
 */
export interface ProjectContext {
    workspace: string;
    projectPath: string;
    platform: PlatformType;
    arch: ArchitectureType;
    javaVersion: string;
    jdkHome: string;
    toolHome: string;
    toolBin: string;
    /**
     * True when the project ships its own Maven Wrapper (`mvnw`/`mvnw.cmd` in
     * the project root). Drives whether Jaenvtix points
     * `maven.executable.path` to its own wrapper or yields to the project's
     * mvnw (preserving the team's pinned Maven version).
     */
    hasMvnw: boolean;
}

/**
 * Resolved filesystem paths for a single Java version's JDK and Maven
 * installation inside the Jaenvtix cache. Produced by `PrepareVersionPathsStep`
 * and consumed by download, extraction, and settings-writing steps.
 */
export interface VersionPath {
    jdkHome: string;
    toolHome: string;
    toolBin: string;
}

/**
 * Mutable state object threaded through every configuration step. Each step
 * reads from and writes to this object; later steps depend on values set by
 * earlier ones. `createInitialState()` always produces a well-formed empty
 * starting state.
 */
export interface JavaConfigurationState {
    workspaceFolders: string[];
    platform?: PlatformType;
    arch?: ArchitectureType;
    mavenDistribution?: MavenDistribution;
    /** Java version string (e.g. `'17'`) → list of project paths requiring that version. */
    projectVersionMap: Map<string, string[]>;
    /**
     * Project absolute path → whether the project ships its own `mvnw`.
     * Populated by `ResolveProjectsStep` so downstream steps can:
     * - avoid re-running the filesystem detection,
     * - decide whether the Maven download/extraction is needed at all
     *   (skipped when every project ships `mvnw`).
     */
    projectsHasMvnw: Map<string, boolean>;
    /**
     * Java major version (string, e.g. `'17'`) → absolute path of an already
     * installed JDK on the user's machine. Populated by `DetectInstalledJdksStep`
     * before `PrepareVersionPathsStep` decides whether each version needs
     * a download into the Jaenvtix cache.
     */
    detectedJdks: Map<string, string>;
    /** Java version string → resolved paths for JDK and Maven installations. */
    versionPaths: Map<string, VersionPath>;
    projectContexts: ProjectContext[];
    /** Java version string → in-flight download promise for the JDK archive. */
    jdkDownloads: Map<string, Promise<DownloadResult>>;
    mavenDownload?: Promise<DownloadResult>;
    /**
     * Project absolute path → Maven version pinned in its pom
     * (`<prerequisites><maven>` or `<properties><maven.version>`). Populated
     * by `ResolveProjectsStep` (empty when `jaenvtix.isolatedMavenPerProject`
     * is off). Projects absent from this map use the shared Jaenvtix-latest
     * Maven (`mvn-custom`).
     */
    projectMavenVersions: Map<string, string>;
    /** Pinned Maven version string → in-flight download promise for its archive. */
    pinnedMavenDownloads: Map<string, Promise<DownloadResult>>;
    /**
     * Absolute paths of projects whose `.vscode/settings.json` content
     * actually changed in this run. Populated by `ConfigureSettingsStep`;
     * gates the Language Server refresh and verification steps so an
     * idempotent re-run never waits for — or talks to — the server.
     */
    changedProjects: Set<string>;
    /**
     * True when this run wrote or removed `java.jdt.ls.java.home` anywhere.
     * The Language Server only applies a new JDK after a restart, so the
     * command entry point offers a one-click "Restart Language Server" toast.
     */
    jdtLsJavaHomeChanged: boolean;
    /**
     * Projects flagged with a compliance mismatch by the PREVIOUS run
     * (mismatch memento), narrowed to the current contexts. Verification
     * re-checks them even when their settings did not change this run.
     * Populated by `AwaitLanguageServerStep`.
     */
    verificationBacklog: string[];
    /**
     * Result of waiting for the Red Hat Language Server
     * (`AwaitLanguageServerStep`). Undefined while the step has not run or
     * when the wait was skipped because no project needs attention.
     */
    languageServerWait?: ServerReadyWait;
    /**
     * True when `VerifyConfigurationStep` already surfaced a mismatch toast
     * in this run. That toast carries its own restart action, so the generic
     * "JDK changed — restart?" toast is suppressed to avoid a double ask.
     */
    mismatchNotified: boolean;
}

/**
 * Outcome of a single configuration step.
 *
 * - `success: true` — the step completed without issues; the pipeline continues.
 * - `success: false, kind: 'warning'` — the step completed but with a non-fatal
 *   issue that should be surfaced to the user (e.g. a missing optional feature).
 * - `success: false, kind: 'error'` — the step failed; the pipeline is aborted.
 */
export interface ConfigurationStepResult {
    success: boolean;
    kind?: 'warning' | 'error';
    message?: string;
}

/**
 * Contract for a single step in the configuration pipeline. Every step receives
 * the shared mutable `state` object, modifies it in place, and returns a result
 * that signals whether the pipeline should continue.
 */
export interface ConfigurationStep {
    readonly name: string;
    run(state: JavaConfigurationState): Promise<ConfigurationStepResult>;
}

/** Returns a well-formed empty `JavaConfigurationState` to start a new pipeline run. */
export function createInitialState(): JavaConfigurationState {
    return {
        workspaceFolders: [],
        projectVersionMap: new Map(),
        projectsHasMvnw: new Map(),
        detectedJdks: new Map(),
        versionPaths: new Map(),
        projectContexts: [],
        jdkDownloads: new Map(),
        projectMavenVersions: new Map(),
        pinnedMavenDownloads: new Map(),
        changedProjects: new Set(),
        jdtLsJavaHomeChanged: false,
        verificationBacklog: [],
        mismatchNotified: false,
    };
}

/**
 * Factory helpers for building `ConfigurationStepResult` values. Using these
 * keeps step implementations consistent and avoids typos in the `kind` field.
 */
export const StepResult = {
    /** Step completed without issues; the pipeline continues. */
    success(): ConfigurationStepResult {
        return {success: true};
    },
    /** Step completed but with a non-fatal issue; the pipeline is halted with a warning. */
    warning(message: string): ConfigurationStepResult {
        return {success: false, kind: 'warning', message};
    },
    /** Step failed; the pipeline is aborted with an error. */
    error(message: string): ConfigurationStepResult {
        return {success: false, kind: 'error', message};
    },
};
