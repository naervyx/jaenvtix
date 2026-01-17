import {ProjectContext} from '../../core/contextCore';
import {VersionPath} from '../../core/versionCore';
import {DownloadResult} from '../../util/fileDownload';
import {PlatformType} from '../../core/type/platformType';
import {ArchitectureType} from '../../core/type/architectureType';
import {MavenDistribution} from '../../core/mavenCore';

export interface JavaConfigurationState {
    workspaceFolder?: string;
    platform?: PlatformType;
    arch?: ArchitectureType;
    mavenDistribution?: MavenDistribution;
    projectVersionMap: Map<string, string[]>;
    versionPaths: Map<string, VersionPath>;
    projectContexts: ProjectContext[];
    jdkDownloadCache: Map<string, Promise<DownloadResult>>;
    mavenDownloadCache: Map<string, Promise<DownloadResult>>;
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
        jdkDownloadCache: new Map(),
        mavenDownloadCache: new Map(),
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
