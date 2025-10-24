import * as vscode from "vscode";

import { createLogger, err, ok, retry } from "@shared/index";
import type { Result } from "@shared/result";

const logger = createLogger({ name: "jaenvtix.extension" });

function getGreetingMessage(): Result<string, Error> {
    const message = "Hello World from jaenvtix!";

    if (!message) {
        return err(new Error("Greeting message is not configured."));
    }

    return ok(message);
}

export function activate(context: vscode.ExtensionContext): void {
    logger.info("Extension activated");

    const disposable = vscode.commands.registerCommand("jaenvtix.helloWorld", async () => {
        const greetingResult = getGreetingMessage();

        if (!greetingResult.ok) {
            logger.error("Greeting message unavailable", {
                error: greetingResult.error instanceof Error ? greetingResult.error.message : String(greetingResult.error),
            });

            return;
        }

        await retry(() => vscode.window.showInformationMessage(greetingResult.value), {
            retries: 2,
            onRetry: (error, attempt) => {
                logger.warn("Retrying to show greeting", {
                    attempt,
                    error: error instanceof Error ? error.message : String(error),
                });
            },
        });
    });

    context.subscriptions.push(disposable);
}

export function deactivate(): void {
    logger.info("Extension deactivated");
}
