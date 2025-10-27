import path from 'node:path';
import runtimeModule from 'node:module';

interface ModuleLoader {
        (request: string, parent: NodeModule | null, isMain: boolean): unknown;
}

interface ProgressReporter {
        report(value: unknown): void;
}

interface ProgressTask<T> {
        (progress: ProgressReporter): T | Promise<T>;
}

const moduleConstructor = runtimeModule as unknown as { _load: ModuleLoader };
const originalLoad = moduleConstructor._load;

const configurationValues = new Map<string, unknown>();

const vendorRoot = path.resolve(__dirname, '..', '..', 'vendor');

const workspaceConfiguration = {
        get<T>(section: string): T | undefined {
                return configurationValues.get(section) as T | undefined;
        },
};

const vscodeStub = {
        workspace: {
                workspaceFolders: [] as Array<{ name: string; uri: { fsPath: string } }>,
                getConfiguration(): typeof workspaceConfiguration {
                        return workspaceConfiguration;
                },
        },
        window: {
                async showInformationMessage(): Promise<undefined> {
                        return undefined;
                },
                async showErrorMessage(): Promise<undefined> {
                        return undefined;
                },
                async showWarningMessage(): Promise<undefined> {
                        return undefined;
                },
                async withProgress<T>(
                        _options: unknown,
                        task: ProgressTask<T>,
                ): Promise<T> {
                        return task({ report() {} });
                },
        },
        commands: {
                registerCommand(): { dispose(): void } {
                        return { dispose() {} };
                },
                async executeCommand(): Promise<undefined> {
                        return undefined;
                },
        },
} as const;

moduleConstructor._load = function loadModule(request: string, parent: NodeModule | null, isMain: boolean) {
        if (request === 'vscode') {
                return vscodeStub;
        }

        if (request === 'jsonc-parser') {
                const target = path.resolve(vendorRoot, 'jsonc-parser', 'index.js');

                return originalLoad.call(this, target, parent, isMain);
        }

        return originalLoad.call(this, request, parent, isMain);
};
