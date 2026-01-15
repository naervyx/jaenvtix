import {PlatformType} from "./type/platformType";
import {ArchitectureType} from "./type/architectureType";

export interface ProjectContext {
    readonly workspace: string;
    readonly projectPath: string;
    readonly platform: PlatformType;
    readonly arch: ArchitectureType;
    readonly javaVersion: string;
    readonly jdkHome: string;
    readonly toolHome: string;
    readonly toolBin: string;
}

export interface ProjectContextData {
    workspace: string;
    projectPath: string;
    platform?: PlatformType;
    arch?: ArchitectureType;
    javaVersion?: string;
    jdkHome?: string;
    toolHome?: string;
    toolBin?: string;
}

export class ProjectContextBuilder {
    private readonly data: ProjectContextData;

    constructor(workspace: string, projectPath: string) {
        this.data = { workspace, projectPath };
    }

    withSystemInfo(platform: PlatformType, arch: ArchitectureType): this {
        this.data.platform = platform;
        this.data.arch = arch;
        return this;
    }

    withJavaVersion(version: string): this {
        this.data.javaVersion = version;
        return this;
    }

    withJdkHome(jdkHome: string): this {
        this.data.jdkHome = jdkHome;
        return this;
    }

    withToolPaths(toolHome: string, toolBin: string): this {
        this.data.toolHome = toolHome;
        this.data.toolBin = toolBin;
        return this;
    }

    build(): ProjectContext {
        const { workspace, projectPath, platform, arch, javaVersion, jdkHome, toolHome, toolBin } = this.data;

        if (!platform || !arch || !javaVersion || !jdkHome || !toolHome || !toolBin) {
            throw new Error('Todos os campos são obrigatórios para construir o contexto');
        }

        return Object.freeze({
            workspace,
            projectPath,
            platform,
            arch,
            javaVersion,
            jdkHome,
            toolHome,
            toolBin,
        });
    }
}