import * as vscode from 'vscode';

import {runConfigureJavaCommand} from './features/configuration/configureJavaCommand';

export async function activate(context: vscode.ExtensionContext) {
    const configureJava = vscode.commands.registerCommand('jaenvtix.configureJava', runConfigureJavaCommand);
    context.subscriptions.push(configureJava);
}
