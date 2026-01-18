import {DownloadResult} from '../util/fileDownload';
import {ArchitectureType, PlatformType} from '../core/system';
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
}

export interface VersionPath {
    jdkHome: string;
    toolHome: string;
    toolBin: string;
}

export interface JavaConfigurationState {
    workspaceFolder?: string;
    platform?: PlatformType;
    arch?: ArchitectureType;
    mavenDistribution?: MavenDistribution;
    projectVersionMap: Map<string, string[]>;
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
        projectVersionMap: new Map(),
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
