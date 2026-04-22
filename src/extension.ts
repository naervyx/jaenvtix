import * as vscode from 'vscode';

import {runConfigureJavaCommand} from './configuration/configureJavaCommand';

export async function activate(context: vscode.ExtensionContext) {
    const configureJava = vscode.commands.registerCommand('jaenvtix.configureJava', runConfigureJavaCommand);
    context.subscriptions.push(configureJava);
}
