import * as path from "node:path";

import * as vscode from "vscode";

import { createLogger, type Logger } from "@shared/logger";

import { downloadArtifact, type DownloadArtifactOptions } from "../downloader";
import { extract } from "../extractor";
import {
    ensureBaseLayout,
    getPathsForVersion,
    type BaseLayoutPaths,
    type VersionLayoutPaths,
} from "../fsLayout";
import { resolveJdkDistribution, type JdkDistribution } from "../jdkMapper";
import { ensureSettings, syncToolchains, type ToolchainEntry } from "../mavenConfig";
import { detectPlatform, type PlatformInfo } from "../platformInfo";
import type { Reporter, StepHandle } from "../reporting";
import { scanWorkspaceForPom } from "../scannerPom";
import { updateWorkspaceSettings, type ToolchainInfo } from "../vscodeConfig";

export interface ProvisioningDependencies {
    readonly detectPlatform: typeof detectPlatform;
    readonly scanWorkspaceForPom: typeof scanWorkspaceForPom;
    readonly resolveJdkDistribution: typeof resolveJdkDistribution;
    readonly ensureBaseLayout: typeof ensureBaseLayout;
    readonly getPathsForVersion: typeof getPathsForVersion;
    readonly downloadArtifact: typeof downloadArtifact;
    readonly extract: typeof extract;
    readonly syncToolchains: typeof syncToolchains;
    readonly ensureSettings: typeof ensureSettings;
    readonly updateWorkspaceSettings: typeof updateWorkspaceSettings;
}

export type ProvisioningProjectStatus = "skipped" | "provisioned" | "failed";

export interface ProvisioningProjectResult {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly pomPath: string;
    readonly projectPath: string;
    readonly javaVersion?: string;
    readonly distribution?: JdkDistribution;
    readonly status: ProvisioningProjectStatus;
    readonly error?: Error;
}

export interface ProvisioningWorkspaceResult {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly projects: readonly ProvisioningProjectResult[];
}

export interface ProvisioningSummary {
    readonly platform: PlatformInfo;
    readonly layout: BaseLayoutPaths;
    readonly workspaces: readonly ProvisioningWorkspaceResult[];
}

export interface DetectionProjectResult {
    readonly pomPath: string;
    readonly projectPath: string;
    readonly javaVersion?: string;
}

export interface DetectionWorkspaceResult {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly projects: readonly DetectionProjectResult[];
}

export interface OrchestratorOptions {
    readonly logger?: Logger;
    readonly reporter?: Reporter;
    readonly configuration?: Pick<vscode.WorkspaceConfiguration, "get">;
    readonly dependencies?: Partial<ProvisioningDependencies>;
    readonly downloadOptions?: Pick<
        DownloadArtifactOptions,
        "retryOptions" | "onProgress" | "signal" | "fetchOptions"
    >;
}

export interface ProvisioningOrchestrator {
    runProvisioning(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<ProvisioningSummary>;
    detectJavaVersions(
        workspaceFolders: readonly vscode.WorkspaceFolder[],
    ): Promise<readonly DetectionWorkspaceResult[]>;
}

const defaultDependencies: ProvisioningDependencies = {
    detectPlatform,
    scanWorkspaceForPom,
    resolveJdkDistribution,
    ensureBaseLayout,
    getPathsForVersion,
    downloadArtifact,
    extract,
    syncToolchains,
    ensureSettings,
    updateWorkspaceSettings,
};

interface VersionArtifacts {
    readonly distribution: JdkDistribution;
    readonly paths: VersionLayoutPaths;
}

export function createProvisioningOrchestrator(options: OrchestratorOptions = {}): ProvisioningOrchestrator {
    const logger = options.logger ?? createLogger({ name: "jaenvtix.orchestrator" });
    const reporter = options.reporter;
    const configuration = options.configuration ?? vscode.workspace.getConfiguration();
    const dependencies = { ...defaultDependencies, ...(options.dependencies ?? {}) } satisfies ProvisioningDependencies;

    return {
        async runProvisioning(workspaceFolders) {
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error("No workspace folders available for provisioning.");
            }

            const platform = dependencies.detectPlatform({ configuration });
            const baseLayout = await dependencies.ensureBaseLayout();
            const workspaces: ProvisioningWorkspaceResult[] = [];
            const versionArtifacts = new Map<string, Promise<VersionArtifacts>>();

            for (const folder of workspaceFolders) {
                const projects: ProvisioningProjectResult[] = [];
                const pomFiles = await dependencies.scanWorkspaceForPom(folder.uri.fsPath);

                for (const pom of pomFiles) {
                    const projectPath = path.dirname(pom.path);
                    const projectLogger = logger.child({
                        defaultFields: { projectPath, workspace: folder.name },
                    });

                    const baseProject: Omit<ProvisioningProjectResult, "status" | "distribution" | "error"> = {
                        workspaceFolder: folder,
                        pomPath: pom.path,
                        projectPath,
                        javaVersion: pom.javaVersion,
                    };

                    if (!pom.javaVersion) {
                        projectLogger.info("Skipping provisioning due to missing Java version in pom.xml");
                        projects.push({ ...baseProject, status: "skipped" });
                        continue;
                    }

                    let step: StepHandle | undefined;
                    const reporterInstance = reporter;
                    let attempt = 1;
                    let projectStatus: ProvisioningProjectStatus = "provisioned";
                    let projectDistribution: JdkDistribution | undefined;
                    let projectError: Error | undefined;

                    try {
                        if (reporterInstance) {
                            try {
                                step = await reporterInstance.startStep("Provision project", {
                                    path: projectPath,
                                });
                            } catch (error) {
                                projectLogger.warn("Failed to start reporting step", {
                                    error: serializeErrorMessage(error),
                                });
                            }
                        }

                        const normalizedVersion = pom.javaVersion.trim();
                        const provisionVersion = async (): Promise<VersionArtifacts> => {
                            const distribution = dependencies.resolveJdkDistribution({
                                version: normalizedVersion,
                                os: platform.os,
                                arch: platform.arch,
                                configuration,
                            });
                            const paths = dependencies.getPathsForVersion(distribution.version, {
                                baseDir: baseLayout.baseDir,
                            });
                            const archiveName = deriveArchiveName(distribution);
                            const destination = path.join(baseLayout.tempDir, archiveName);

                            projectLogger.info("Downloading JDK distribution", {
                                url: distribution.url,
                                destination,
                            });
                            const downloadPath = await dependencies.downloadArtifact(distribution.url, {
                                destination,
                                expectedChecksum: distribution.checksum,
                                configuration,
                                logger: projectLogger,
                                ...(options.downloadOptions ?? {}),
                            });

                            projectLogger.info("Extracting JDK archive", {
                                archivePath: downloadPath,
                                destination: paths.jdkHome,
                            });
                            await dependencies.extract(downloadPath, paths.jdkHome);

                            const toolchain: ToolchainEntry = {
                                vendor: distribution.vendor,
                                versions: [distribution.version],
                                javaHome: paths.jdkHome,
                            };

                            await dependencies.syncToolchains(toolchain);
                            await dependencies.ensureSettings();

                            return { distribution, paths };
                        };

                        let artifactPromise = versionArtifacts.get(normalizedVersion);
                        if (!artifactPromise) {
                            artifactPromise = provisionVersion();
                            versionArtifacts.set(normalizedVersion, artifactPromise);
                        }

                        let artifacts: VersionArtifacts;
                        try {
                            artifacts = await artifactPromise;
                        } catch (error) {
                            versionArtifacts.delete(normalizedVersion);
                            throw error;
                        }

                        const toolchainInfo: ToolchainInfo = {
                            javaHome: artifacts.paths.jdkHome,
                            mavenWrapper: artifacts.paths.mavenWrapper,
                        };

                        await dependencies.updateWorkspaceSettings(projectPath, toolchainInfo);

                        projectDistribution = artifacts.distribution;
                        projectLogger.info("Provisioned project successfully", {
                            javaHome: artifacts.paths.jdkHome,
                        });

                        if (step && reporterInstance) {
                            await reporterInstance.endStep(step, {
                                attempt,
                                path: projectPath,
                            });
                        }
                    } catch (error) {
                        attempt += 1;
                        const normalizedError = normalizeError(error);
                        projectStatus = "failed";
                        projectError = normalizedError;
                        projectLogger.error("Failed to provision project", {
                            error: normalizedError.message,
                        });

                        if (step && reporterInstance) {
                            await reporterInstance.failStep(step, normalizedError, {
                                attempt,
                                path: projectPath,
                            });
                        }
                    } finally {
                        projects.push({
                            ...baseProject,
                            status: projectStatus,
                            ...(projectDistribution ? { distribution: projectDistribution } : {}),
                            ...(projectError ? { error: projectError } : {}),
                        });
                    }
                }

                workspaces.push({ workspaceFolder: folder, projects });
            }

            return { platform, layout: baseLayout, workspaces };
        },
        async detectJavaVersions(workspaceFolders) {
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return [];
            }

            const results: DetectionWorkspaceResult[] = [];

            for (const folder of workspaceFolders) {
                const pomFiles = await dependencies.scanWorkspaceForPom(folder.uri.fsPath);
                const projects = pomFiles.map<DetectionProjectResult>((pom) => ({
                    pomPath: pom.path,
                    projectPath: path.dirname(pom.path),
                    javaVersion: pom.javaVersion,
                }));

                results.push({ workspaceFolder: folder, projects });
            }

            return results;
        },
    } satisfies ProvisioningOrchestrator;
}

export async function runProvisioning(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    options: OrchestratorOptions = {},
): Promise<ProvisioningSummary> {
    const orchestrator = createProvisioningOrchestrator(options);

    return orchestrator.runProvisioning(workspaceFolders);
}

function deriveArchiveName(distribution: JdkDistribution): string {
    try {
        const parsed = new URL(distribution.url);
        const candidate = path.basename(parsed.pathname);

        if (candidate) {
            return candidate;
        }
    } catch {
        // Ignore URL parsing errors and use fallback naming.
    }

    return `jdk-${distribution.vendor}-${distribution.version}.tar.gz`;
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(typeof error === "string" ? error : JSON.stringify(error));
}

function serializeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    return JSON.stringify(error);
}
