import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Jaenvtix');

    const disposable = vscode.commands.registerCommand('jaenvtix.setup', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Nenhuma pasta de workspace aberta.');
            return;
        }

        const pythonPath =
            vscode.workspace.getConfiguration('jaenvtix').get<string>('pythonPath') || 'python';

        const scriptPath = path.join(context.extensionPath, 'python', 'jaenvtix_setup.py');
        const cwd = workspaceFolder.uri.fsPath;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Jaenvtix: configurando Java/Maven…',
                cancellable: false
            },
            () =>
                new Promise<void>((resolve, reject) => {
                    output.appendLine(`Executando: ${pythonPath} ${scriptPath}`);
                    output.appendLine(`CWD: ${cwd}`);

                    const proc = spawn(pythonPath, [scriptPath], {
                        cwd,
                        shell: true
                    });

                    proc.stdout.on('data', data => {
                        output.append(data.toString());
                    });

                    proc.stderr.on('data', data => {
                        output.append(data.toString());
                    });

                    proc.on('close', code => {
                        if (code === 0) {
                            vscode.window.showInformationMessage(
                                'Jaenvtix: configuração concluída com sucesso.'
                            );
                            resolve();
                        } else {
                            vscode.window.showErrorMessage(
                                `Jaenvtix: script terminou com código ${code}. Veja o painel de saída "Jaenvtix".`
                            );
                            reject(new Error(`Exit code ${code}`));
                        }
                    });

                    proc.on('error', err => {
                        vscode.window.showErrorMessage(`Erro ao executar Python: ${String(err)}`);
                        reject(err);
                    });
                })
        );
    });

    context.subscriptions.push(disposable, output);
}

export function deactivate() {}
