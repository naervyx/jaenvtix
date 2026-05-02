import {DownloadResult} from '../file/fileDownload';
import {ArchitectureType, PlatformType} from './system';
import {MavenDistribution} from '../build/mavenUrl';

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

export interface VersionPath {
    jdkHome: string;
    toolHome: string;
    toolBin: string;
}

export interface JavaConfigurationState {
    workspaceFolders: string[];
    platform?: PlatformType;
    arch?: ArchitectureType;
    mavenDistribution?: MavenDistribution;
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
     * Java major version (string, e.g. '17') → absolute path of an already
     * installed JDK on the user's machine. Populated by the detection step
     * before `PrepareVersionPathsStep` decides whether each version needs
     * a download into the Jaenvtix cache.
     */
    detectedJdks: Map<string, string>;
    versionPaths: Map<string, VersionPath>;
    projectContexts: ProjectContext[];
    jdkDownloads: Map<string, Promise<DownloadResult>>;
    mavenDownload?: Promise<DownloadResult>;
}

export interface ConfigurationStepResult {
    success: boolean;
    kind?: 'warning' | 'error';
    message?: string;
}

export interface ConfigurationStep {
    readonly name: string;
    run(state: JavaConfigurationState): Promise<ConfigurationStepResult>;
}

export function createInitialState(): JavaConfigurationState {
    return {
        workspaceFolders: [],
        projectVersionMap: new Map(),
        projectsHasMvnw: new Map(),
        detectedJdks: new Map(),
        versionPaths: new Map(),
        projectContexts: [],
        jdkDownloads: new Map(),
    };
}

export const StepResult = {
    success(): ConfigurationStepResult {
        return { success: true };
    },
    warning(message: string): ConfigurationStepResult {
        return { success: false, kind: 'warning', message };
    },
    error(message: string): ConfigurationStepResult {
        return { success: false, kind: 'error', message };
    },
};
