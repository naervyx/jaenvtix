import { strict as assert } from "node:assert";

import type * as vscode from "vscode";

import {
    createProvisioningOrchestrator,
    type DetectionWorkspaceResult,
    type ProvisioningDependencies,
    type ProvisioningSummary,
} from "../modules/orchestrator";
import type { Logger } from "../shared/logger";

const shouldSkipIntegration = process.env.JAENVTIX_SKIP_INTEGRATION_TESTS === "1";
const integrationSuite = shouldSkipIntegration ? suite.skip : suite;

integrationSuite("Provisioning orchestrator integration", () => {
    test("provisions shared versions across multiple workspaces", async () => {
        const workspaceFolders = createWorkspaceFolders([
            { name: "alpha", path: "/workspace/alpha" },
            { name: "beta", path: "/workspace/beta" },
        ]);

        const pomResults = new Map<string, Array<{ path: string; javaVersion?: string }>>([
            [
                "/workspace/alpha",
                [
                    {
                        path: "/workspace/alpha/service-a/pom.xml",
                        javaVersion: "17",
                    },
                    {
                        path: "/workspace/alpha/service-b/pom.xml",
                    },
                ],
            ],
            [
                "/workspace/beta",
                [
                    {
                        path: "/workspace/beta/app/pom.xml",
                        javaVersion: "17",
                    },
                ],
            ],
        ]);

        const updatedSettings: Array<{ projectPath: string; javaHome: string; mavenWrapper?: string }> = [];
        let downloadCount = 0;
        let extractCount = 0;
        const syncedToolchains: string[] = [];

        const dependencies: ProvisioningDependencies = {
            detectPlatform: () => ({ os: "linux", arch: "x64" }),
            scanWorkspaceForPom: async (workspaceRoot?: string) =>
                pomResults.get(workspaceRoot ?? "") ?? [],
            resolveJdkDistribution: ({ version }) => ({
                vendor: "temurin",
                version,
                os: "linux",
                arch: "x64",
                url: `https://example.com/jdk-${version}.tar.gz`,
                license: "Example License",
            }),
            ensureBaseLayout: async () => ({
                baseDir: "/home/test/.jaenvtix",
                tempDir: "/home/test/.jaenvtix/temp",
            }),
            getPathsForVersion: (version, options) => {
                const baseDir = options?.baseDir ?? "/home/test/.jaenvtix";
                assert.strictEqual(options?.platform, "linux");

                return {
                    baseDir,
                    tempDir: `${baseDir}/temp`,
                    majorVersionDir: `${baseDir}/jdk-${version}`,
                    jdkHome: `${baseDir}/jdk-${version}/${version}`,
                    mavenDir: `${baseDir}/jdk-${version}/maven`,
                    mavenBin: `${baseDir}/jdk-${version}/maven/bin`,
                    mavenWrapper: `${baseDir}/jdk-${version}/maven/bin/mvn-jaenvtix`,
                    mavenDaemon: `${baseDir}/jdk-${version}/maven/bin/mvnd`,
                    toolchainsFile: `/home/test/.m2/toolchains.xml`,
                };
            },
            cleanupTempDirectory: async () => {},
            downloadArtifact: async (_url, { destination }) => {
                downloadCount += 1;

                return destination;
            },
            extract: async () => {
                extractCount += 1;

                return "extracted";
            },
            syncToolchains: async (entry) => {
                syncedToolchains.push(`${entry.vendor}:${entry.versions.join(",")}`);
            },
            ensureSettings: async () => "/home/test/.m2/settings.xml",
            updateWorkspaceSettings: async (projectPath, toolchainInfo) => {
                updatedSettings.push({
                    projectPath,
                    javaHome: toolchainInfo.javaHome,
                    mavenWrapper: toolchainInfo.mavenWrapper,
                });
            },
            pathExists: async () => true,
        };

        const orchestrator = createProvisioningOrchestrator({
            dependencies,
            logger: createSilentLogger(),
        });

        const summary: ProvisioningSummary = await orchestrator.runProvisioning(workspaceFolders);

        assert.strictEqual(downloadCount, 1, "should download the shared JDK only once");
        assert.strictEqual(extractCount, 1, "should extract the shared JDK only once");
        assert.deepStrictEqual(syncedToolchains, ["temurin:17"], "should sync toolchains for the provisioned version");

        const provisionedProjects = summary.workspaces.flatMap((workspace) =>
            workspace.projects.map((project) => ({
                workspace: workspace.workspaceFolder.name,
                path: project.projectPath,
                status: project.status,
            })),
        );

        assert.deepStrictEqual(provisionedProjects, [
            {
                workspace: "alpha",
                path: "/workspace/alpha/service-a",
                status: "provisioned",
            },
            {
                workspace: "alpha",
                path: "/workspace/alpha/service-b",
                status: "skipped",
            },
            {
                workspace: "beta",
                path: "/workspace/beta/app",
                status: "provisioned",
            },
        ]);

        assert.deepStrictEqual(
            updatedSettings,
            [
                {
                    projectPath: "/workspace/alpha/service-a",
                    javaHome: "/home/test/.jaenvtix/jdk-17/17",
                    mavenWrapper: "/home/test/.jaenvtix/jdk-17/maven/bin/mvn-jaenvtix",
                },
                {
                    projectPath: "/workspace/beta/app",
                    javaHome: "/home/test/.jaenvtix/jdk-17/17",
                    mavenWrapper: "/home/test/.jaenvtix/jdk-17/maven/bin/mvn-jaenvtix",
                },
            ],
            "should update workspace settings for provisioned projects",
        );
    });

    test("omits Maven executable path when wrapper is missing", async () => {
        const workspaceFolders = createWorkspaceFolders([
            { name: "alpha", path: "/workspace/alpha" },
        ]);

        const pomResults = new Map<string, Array<{ path: string; javaVersion?: string }>>([
            [
                "/workspace/alpha",
                [
                    {
                        path: "/workspace/alpha/service-a/pom.xml",
                        javaVersion: "17",
                    },
                ],
            ],
        ]);

        const updatedSettings: Array<{ projectPath: string; javaHome: string; mavenWrapper?: string }> = [];

        const dependencies: ProvisioningDependencies = {
            detectPlatform: () => ({ os: "linux", arch: "x64" }),
            scanWorkspaceForPom: async (workspaceRoot?: string) =>
                pomResults.get(workspaceRoot ?? "") ?? [],
            resolveJdkDistribution: ({ version }) => ({
                vendor: "temurin",
                version,
                os: "linux",
                arch: "x64",
                url: `https://example.com/jdk-${version}.tar.gz`,
                license: "Example License",
            }),
            ensureBaseLayout: async () => ({
                baseDir: "/home/test/.jaenvtix",
                tempDir: "/home/test/.jaenvtix/temp",
            }),
            getPathsForVersion: (version, options) => {
                const baseDir = options?.baseDir ?? "/home/test/.jaenvtix";

                return {
                    baseDir,
                    tempDir: `${baseDir}/temp`,
                    majorVersionDir: `${baseDir}/jdk-${version}`,
                    jdkHome: `${baseDir}/jdk-${version}/${version}`,
                    mavenDir: `${baseDir}/jdk-${version}/maven`,
                    mavenBin: `${baseDir}/jdk-${version}/maven/bin`,
                    mavenWrapper: `${baseDir}/jdk-${version}/maven/bin/mvn-jaenvtix`,
                    mavenDaemon: `${baseDir}/jdk-${version}/maven/bin/mvnd`,
                    toolchainsFile: `/home/test/.m2/toolchains.xml`,
                };
            },
            cleanupTempDirectory: async () => {},
            downloadArtifact: async (_url, { destination }) => destination,
            extract: async () => "extracted",
            syncToolchains: async () => {},
            ensureSettings: async () => "/home/test/.m2/settings.xml",
            updateWorkspaceSettings: async (projectPath, toolchainInfo) => {
                updatedSettings.push({
                    projectPath,
                    javaHome: toolchainInfo.javaHome,
                    mavenWrapper: toolchainInfo.mavenWrapper,
                });
            },
            pathExists: async (target) => !target.endsWith("mvn-jaenvtix"),
        };

        const orchestrator = createProvisioningOrchestrator({
            dependencies,
            logger: createSilentLogger(),
        });

        await orchestrator.runProvisioning(workspaceFolders);

        assert.deepStrictEqual(updatedSettings, [
            {
                projectPath: "/workspace/alpha/service-a",
                javaHome: "/home/test/.jaenvtix/jdk-17/17",
                mavenWrapper: undefined,
            },
        ]);
    });

    test("confirms retries before continuing provisioning attempts", async () => {
        const workspaceFolders = createWorkspaceFolders([
            { name: "alpha", path: "/workspace/alpha" },
        ]);

        const pomResults = new Map<string, Array<{ path: string; javaVersion?: string }>>([
            [
                "/workspace/alpha",
                [
                    {
                        path: "/workspace/alpha/service-a/pom.xml",
                        javaVersion: "21",
                    },
                ],
            ],
        ]);

        let downloadAttempts = 0;
        let cleanupAttempts = 0;

        const dependencies: ProvisioningDependencies = {
            detectPlatform: () => ({ os: "linux", arch: "x64" }),
            scanWorkspaceForPom: async (workspaceRoot?: string) =>
                pomResults.get(workspaceRoot ?? "") ?? [],
            resolveJdkDistribution: ({ version }) => ({
                vendor: "temurin",
                version,
                os: "linux",
                arch: "x64",
                url: `https://example.com/jdk-${version}.tar.gz`,
                license: "Example License",
            }),
            ensureBaseLayout: async () => ({
                baseDir: "/home/test/.jaenvtix",
                tempDir: "/home/test/.jaenvtix/temp",
            }),
            getPathsForVersion: (version, options) => {
                const baseDir = options?.baseDir ?? "/home/test/.jaenvtix";
                assert.strictEqual(options?.platform, "linux");

                return {
                    baseDir,
                    tempDir: `${baseDir}/temp`,
                    majorVersionDir: `${baseDir}/jdk-${version}`,
                    jdkHome: `${baseDir}/jdk-${version}/${version}`,
                    mavenDir: `${baseDir}/jdk-${version}/maven`,
                    mavenBin: `${baseDir}/jdk-${version}/maven/bin`,
                    mavenWrapper: `${baseDir}/jdk-${version}/maven/bin/mvn-jaenvtix`,
                    mavenDaemon: `${baseDir}/jdk-${version}/maven/bin/mvnd`,
                    toolchainsFile: `/home/test/.m2/toolchains.xml`,
                };
            },
            cleanupTempDirectory: async () => {
                cleanupAttempts += 1;
            },
            downloadArtifact: async (_url, { destination }) => {
                downloadAttempts += 1;

                if (downloadAttempts < 2) {
                    throw new Error("temporary network failure");
                }

                return destination;
            },
            extract: async () => "extracted",
            syncToolchains: async () => {},
            ensureSettings: async () => "/home/test/.m2/settings.xml",
            updateWorkspaceSettings: async () => {},
            pathExists: async () => true,
        };

        const prompts: string[] = [];
        const windowStub = {
            showWarningMessage: async (
                message: string,
                _options: vscode.MessageOptions,
                retryLabel: string,
            ) => {
                prompts.push(message);

                return retryLabel;
            },
        } satisfies Pick<typeof vscode.window, "showWarningMessage">;

        const orchestrator = createProvisioningOrchestrator({
            dependencies,
            window: windowStub,
            logger: createSilentLogger(),
        });

        const summary = await orchestrator.runProvisioning(workspaceFolders);

        assert.strictEqual(downloadAttempts, 2, "should retry once after confirmation");
        assert.ok(cleanupAttempts >= 1, "should attempt to clean temporary directory");
        assert.strictEqual(prompts.length, 1, "should prompt before retrying");

        const project = summary.workspaces[0]?.projects[0];
        assert.ok(project);
        assert.strictEqual(project?.status, "provisioned");
    });

    test("detects pom files without provisioning", async () => {
        const workspaceFolders = createWorkspaceFolders([
            { name: "alpha", path: "/workspace/alpha" },
        ]);

        const dependencies: ProvisioningDependencies = {
            detectPlatform: () => ({ os: "linux", arch: "x64" }),
            scanWorkspaceForPom: async () => [
                { path: "/workspace/alpha/service-a/pom.xml", javaVersion: "21" },
            ],
            resolveJdkDistribution: () => {
                throw new Error("should not resolve distributions during detection");
            },
            ensureBaseLayout: async () => {
                throw new Error("should not ensure layout during detection");
            },
            getPathsForVersion: () => {
                throw new Error("should not resolve paths during detection");
            },
            cleanupTempDirectory: async () => {
                throw new Error("should not clean temp during detection");
            },
            downloadArtifact: async () => {
                throw new Error("should not download during detection");
            },
            extract: async () => {
                throw new Error("should not extract during detection");
            },
            syncToolchains: async () => {
                throw new Error("should not sync toolchains during detection");
            },
            ensureSettings: async () => {
                throw new Error("should not ensure settings during detection");
            },
            updateWorkspaceSettings: async () => {
                throw new Error("should not update settings during detection");
            },
            pathExists: async () => {
                throw new Error("should not check path existence during detection");
            },
        };

        const orchestrator = createProvisioningOrchestrator({
            dependencies,
            logger: createSilentLogger(),
        });

        const results: readonly DetectionWorkspaceResult[] = await orchestrator.detectJavaVersions(workspaceFolders);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0]?.workspaceFolder.name, "alpha");
        assert.deepStrictEqual(results[0]?.projects, [
            {
                pomPath: "/workspace/alpha/service-a/pom.xml",
                projectPath: "/workspace/alpha/service-a",
                javaVersion: "21",
            },
        ]);
    });
});

function createWorkspaceFolders(
    entries: readonly { name: string; path: string }[],
): vscode.WorkspaceFolder[] {
    return entries.map((entry, index) => ({
        name: entry.name,
        index,
        uri: { fsPath: entry.path } as vscode.Uri,
    }));
}

function createSilentLogger(): Logger {
    const logger: Logger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => logger,
    };

    return logger;
}
