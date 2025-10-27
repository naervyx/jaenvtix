import * as vscode from "vscode";

import { createLogger } from "@shared/index";

import {
    createProvisioningOrchestrator,
    type DetectionWorkspaceResult,
    type ProvisioningOrchestrator,
    type ProvisioningSummary,
} from "./modules/orchestrator";
import { createReporter, type Reporter } from "./modules/reporting";

const logger = createLogger({ name: "jaenvtix.extension" });

let reporter: Reporter | undefined;
let orchestrator: ProvisioningOrchestrator | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.info("Extension activated");

    reporter = await initializeReporter(context);
    orchestrator = createProvisioningOrchestrator({ reporter, logger });

    const detectDisposable = vscode.commands.registerCommand(
        "jaenvtix.detectJavaVersion",
        async () => {
            await handleDetectCommand();
        },
    );

    const provisionDisposable = vscode.commands.registerCommand(
        "jaenvtix.provisionJdk",
        async () => {
            await handleProvisionCommand();
        },
    );

    context.subscriptions.push(detectDisposable, provisionDisposable);

    await handleWorkspaceActivation();
}

export function deactivate(): void {
    logger.info("Extension deactivated");
    reporter = undefined;
    orchestrator = undefined;
}

async function initializeReporter(context: vscode.ExtensionContext): Promise<Reporter | undefined> {
    try {
        const storagePath = context.globalStorageUri?.fsPath ?? context.globalStoragePath;

        return await createReporter({
            reportDirectory: storagePath,
            window: vscode.window,
        });
    } catch (error) {
        logger.error("Failed to initialize reporter", {
            error: error instanceof Error ? error.message : String(error),
        });

        return undefined;
    }
}

async function handleDetectCommand(): Promise<void> {
    const orchestratorInstance = orchestrator;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        await vscode.window.showInformationMessage(
            "No workspace folders are available to inspect.",
        );

        return;
    }

    if (!orchestratorInstance) {
        await vscode.window.showErrorMessage(
            "Provisioning orchestrator is not ready yet. Please try again in a few moments.",
        );

        return;
    }

    try {
        const detectionResults = await orchestratorInstance.detectJavaVersions(workspaceFolders);

        if (detectionResults.every((workspace) => workspace.projects.length === 0)) {
            await vscode.window.showInformationMessage(
                "No pom.xml files were found in the current workspace.",
            );

            return;
        }

        await showDetectionSummary(detectionResults);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to detect Java versions", { error: message });
        await vscode.window.showErrorMessage(
            `Unable to detect Java versions: ${message}`,
        );
    }
}

async function handleProvisionCommand(): Promise<void> {
    const orchestratorInstance = orchestrator;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        await vscode.window.showInformationMessage(
            "No workspace folders are available for provisioning.",
        );

        return;
    }

    if (!orchestratorInstance) {
        await vscode.window.showErrorMessage(
            "Provisioning orchestrator is not ready yet. Please try again in a few moments.",
        );

        return;
    }

    try {
        const summary = await orchestratorInstance.runProvisioning(workspaceFolders);
        await showProvisioningSummary(summary);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Provisioning failed", { error: message });
        await vscode.window.showErrorMessage(`Provisioning failed: ${message}`);
    }
}

async function handleWorkspaceActivation(): Promise<void> {
    const orchestratorInstance = orchestrator;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!orchestratorInstance || !workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    try {
        const detectionResults = await orchestratorInstance.detectJavaVersions(workspaceFolders);
        const hasProjects = detectionResults.some((workspace) => workspace.projects.length > 0);

        if (!hasProjects) {
            return;
        }

        await vscode.commands.executeCommand("setContext", "jaenvtix.hasPom", true);
        logger.info("Workspace activation detected pom.xml files", {
            projects: detectionResults.flatMap((workspace) =>
                workspace.projects.map((project) => ({
                    pomPath: project.pomPath,
                    javaVersion: project.javaVersion ?? "unknown",
                })),
            ),
        });
    } catch (error) {
        logger.error("Automatic workspace inspection failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function showDetectionSummary(results: readonly DetectionWorkspaceResult[]): Promise<void> {
    const summaryLines = results.flatMap((workspace) => {
        if (workspace.projects.length === 0) {
            return [`${workspace.workspaceFolder.name}: no pom.xml files found`];
        }

        return workspace.projects.map((project) =>
            `${workspace.workspaceFolder.name}: Java ${project.javaVersion ?? "unknown"} (${project.pomPath})`,
        );
    });

    await vscode.window.showInformationMessage(summaryLines.join("\n"));
}

async function showProvisioningSummary(summary: ProvisioningSummary): Promise<void> {
    const successes = summary.workspaces.flatMap((workspace) =>
        workspace.projects.filter((project) => project.status === "provisioned"),
    );
    const failures = summary.workspaces.flatMap((workspace) =>
        workspace.projects.filter((project) => project.status === "failed"),
    );

    if (successes.length > 0) {
        const successLines = successes.map(
            (project) =>
                `${project.workspaceFolder.name}: provisioned JDK ${project.distribution?.version ?? ""} at ${project.projectPath}`,
        );
        await vscode.window.showInformationMessage(successLines.join("\n"));
    }

    if (failures.length > 0) {
        const failureLines = failures.map(
            (project) =>
                `${project.workspaceFolder.name}: failed (${project.error?.message ?? "unknown error"})`,
        );
        await vscode.window.showErrorMessage(failureLines.join("\n"));
    }
}
