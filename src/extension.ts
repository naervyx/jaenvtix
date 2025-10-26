import * as path from "node:path";

import * as vscode from "vscode";

import { createLogger, err, ok, retry } from "@shared/index";
import type { Result } from "@shared/result";
import { createReporter, type Reporter } from "./modules/reporting";

let reporter: Reporter | undefined;

const logger = createLogger({ name: "jaenvtix.extension" });

function getGreetingMessage(): Result<string, Error> {
    const message = "Hello World from jaenvtix!";

    if (!message) {
        return err(new Error("Greeting message is not configured."));
    }

    return ok(message);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.info("Extension activated");

    reporter = await initializeReporter(context);

    const disposable = vscode.commands.registerCommand("jaenvtix.helloWorld", async () => {
        const activeReporter = reporter;
        const workspacePath = resolveWorkspacePath();
        const stepHandle = activeReporter
            ? await activeReporter.startStep("Show greeting", { path: workspacePath ?? undefined })
            : undefined;
        let attempt = 1;

        try {
            const greetingResult = getGreetingMessage();

            if (!greetingResult.ok) {
                logger.error("Greeting message unavailable", {
                    error:
                        greetingResult.error instanceof Error
                            ? greetingResult.error.message
                            : String(greetingResult.error),
                });

                if (stepHandle && activeReporter) {
                    await activeReporter.failStep(stepHandle, greetingResult.error, {
                        attempt,
                        path: workspacePath ?? undefined,
                    });
                }

                return;
            }

            await retry(() => vscode.window.showInformationMessage(greetingResult.value), {
                retries: 2,
                onRetry: (error, retryAttempt) => {
                    attempt = retryAttempt + 1;
                    logger.warn("Retrying to show greeting", {
                        attempt: retryAttempt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                },
            });

            if (stepHandle && activeReporter) {
                await activeReporter.endStep(stepHandle, {
                    attempt,
                    path: workspacePath ?? undefined,
                });
            }
        } catch (error) {
            logger.error("Failed to show greeting", {
                error: error instanceof Error ? error.message : String(error),
            });

            if (stepHandle && activeReporter) {
                await activeReporter.failStep(stepHandle, error, {
                    attempt,
                    path: workspacePath ?? undefined,
                });
            }
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate(): void {
    logger.info("Extension deactivated");
    reporter = undefined;
}

async function initializeReporter(context: vscode.ExtensionContext): Promise<Reporter | undefined> {
    try {
        const storagePath = context.globalStorageUri?.fsPath ?? path.join(context.extensionPath, ".jaenvtix");

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

function resolveWorkspacePath(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    return workspaceFolder ? workspaceFolder.uri.fsPath : null;
}
