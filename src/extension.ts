import * as vscode from 'vscode';
import { TextDecoder } from 'util';

type WorkspaceScanResult = {
    hasPom: boolean;
    pomFiles: vscode.Uri[];
    highestRelease?: string;
};

type ScanReason =
    | 'initial'
    | 'manual'
    | 'workspace change'
    | 'pom created'
    | 'pom changed'
    | 'pom deleted';

class StatusBarProvider implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;
    private currentRelease?: string;
    private currentSource?: string;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.name = 'Jaenvtix: Active JDK';
        this.statusBarItem.command = 'jaenvtix.showJdkStatus';
        this.statusBarItem.tooltip = 'Jaenvtix quick actions';
        this.showDetecting();
        this.statusBarItem.show();
    }

    public showDetecting(): void {
        this.currentSource = undefined;
        this.statusBarItem.text = '$(sync~spin) Jaenvtix';
        this.statusBarItem.tooltip = 'Detecting pom.xml files and Maven release configuration…';
    }

    public showNoPom(): void {
        this.currentRelease = undefined;
        this.currentSource = undefined;
        this.statusBarItem.text = '$(warning) No pom.xml';
        this.statusBarItem.tooltip = 'Open a Maven workspace to enable Jaenvtix automation.';
    }

    public showDetectedRelease(release: string): void {
        this.currentRelease = release;
        this.currentSource = undefined;
        this.statusBarItem.text = `$(search) JDK ${release}`;
        this.statusBarItem.tooltip = `Detected Java release ${release} from pom.xml files.`;
    }

    public showAwaitingRelease(): void {
        this.currentRelease = undefined;
        this.currentSource = undefined;
        this.statusBarItem.text = '$(question) Select Java release';
        this.statusBarItem.tooltip = 'Jaenvtix could not infer a Java release automatically.';
    }

    public showProvisioned(release: string, sourceLabel: string): void {
        this.currentRelease = release;
        this.currentSource = sourceLabel;
        this.statusBarItem.text = `$(check) JDK ${release}`;
        this.statusBarItem.tooltip = `Provisioned via ${sourceLabel}. Click for quick actions.`;
    }

    public getLastKnownRelease(): string | undefined {
        return this.currentRelease;
    }

    public getLastKnownSource(): string | undefined {
        return this.currentSource;
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}

class WorkspaceScanner implements vscode.Disposable {
    private readonly decoder = new TextDecoder('utf-8');
    private readonly disposables: vscode.Disposable[] = [];
    private debounceHandle: NodeJS.Timeout | undefined;

    constructor(
        private readonly onScanResult: (result: WorkspaceScanResult, reason: ScanReason) => Promise<void> | void,
    ) {
        this.registerWorkspaceListeners();
    }

    public async triggerInitialScan(): Promise<void> {
        await this.performScan('initial');
    }

    public async manualScan(notify = true): Promise<WorkspaceScanResult> {
        const result = await this.scanWorkspace();
        if (notify) {
            await this.onScanResult(result, 'manual');
        }
        return result;
    }

    private registerWorkspaceListeners(): void {
        const folderDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this.scheduleScan('workspace change');
        });

        const watcher = vscode.workspace.createFileSystemWatcher('**/pom.xml');
        const createDisposable = watcher.onDidCreate(() => {
            void this.scheduleScan('pom created');
        });
        const changeDisposable = watcher.onDidChange(() => {
            void this.scheduleScan('pom changed');
        });
        const deleteDisposable = watcher.onDidDelete(() => {
            void this.scheduleScan('pom deleted');
        });

        this.disposables.push(folderDisposable, watcher, createDisposable, changeDisposable, deleteDisposable);
    }

    private scheduleScan(reason: ScanReason): void {
        if (this.debounceHandle) {
            clearTimeout(this.debounceHandle);
        }

        this.debounceHandle = setTimeout(() => {
            void this.performScan(reason).catch((error) => {
                console.error('Jaenvtix: workspace scan failed', error);
            });
        }, 250);
    }

    private async performScan(reason: ScanReason): Promise<void> {
        const result = await this.scanWorkspace();
        await this.onScanResult(result, reason);
    }

    private async scanWorkspace(): Promise<WorkspaceScanResult> {
        const pomFiles = await vscode.workspace.findFiles('**/pom.xml', '**/target/**');
        let highestRelease: number | undefined;

        for (const uri of pomFiles) {
            try {
                const document = await vscode.workspace.fs.readFile(uri);
                const contents = this.decoder.decode(document);
                const releaseCandidate = this.extractRelease(contents);
                if (releaseCandidate !== undefined) {
                    if (highestRelease === undefined || releaseCandidate > highestRelease) {
                        highestRelease = releaseCandidate;
                    }
                }
            } catch (error) {
                console.error(`Jaenvtix: failed to read ${uri.fsPath}`, error);
            }
        }

        return {
            hasPom: pomFiles.length > 0,
            pomFiles,
            highestRelease: highestRelease !== undefined ? String(highestRelease) : undefined,
        };
    }

    private extractRelease(contents: string): number | undefined {
        const regexes = [
            /<maven\.compiler\.release>\s*([0-9]+)\s*<\/maven\.compiler\.release>/gi,
            /<release>\s*([0-9]+)\s*<\/release>/gi,
            /<java\.version>\s*([0-9]+)\s*<\/java\.version>/gi,
            /<maven\.compiler\.target>\s*([0-9]+)\s*<\/maven\.compiler\.target>/gi,
            /<maven\.compiler\.source>\s*([0-9]+)\s*<\/maven\.compiler\.source>/gi,
        ];

        let highest: number | undefined;

        for (const regex of regexes) {
            let match: RegExpExecArray | null;
            while ((match = regex.exec(contents)) !== null) {
                const numeric = parseInt(match[1], 10);
                if (!Number.isNaN(numeric)) {
                    if (highest === undefined || numeric > highest) {
                        highest = numeric;
                    }
                }
            }
        }

        return highest;
    }

    public dispose(): void {
        if (this.debounceHandle) {
            clearTimeout(this.debounceHandle);
            this.debounceHandle = undefined;
        }

        vscode.Disposable.from(...this.disposables).dispose();
    }
}

class ProvisioningService implements vscode.Disposable {
    private lastDetection: WorkspaceScanResult | undefined;
    private lastKnownRelease: string | undefined;
    private lastProvisionedRelease: string | undefined;
    private readonly promptedReleases = new Set<string>();

    constructor(private readonly statusBar: StatusBarProvider) {}

    public async handleDetection(result: WorkspaceScanResult, reason: ScanReason): Promise<void> {
        this.lastDetection = result;

        if (!result.hasPom) {
            this.statusBar.showNoPom();
            if (reason === 'initial') {
                await vscode.window.showInformationMessage(
                    'Jaenvtix did not find any pom.xml files in this workspace. Open a Maven project to enable automatic setup.',
                );
            }
            return;
        }

        if (!result.highestRelease) {
            this.statusBar.showAwaitingRelease();
            if (reason === 'initial') {
                const configureNow = 'Choose release manually';
                const response = await vscode.window.showInformationMessage(
                    'Jaenvtix found pom.xml files but could not determine a Java release. Configure Maven or choose a release manually to continue.',
                    configureNow,
                    'Skip for now',
                );
                if (response === configureNow) {
                    const manualRelease = await this.promptManualReleaseChoice();
                    if (manualRelease) {
                        await this.applyManualRelease(result, manualRelease);
                    }
                }
            } else if (reason === 'manual') {
                const manualRelease = await this.promptManualReleaseChoice();
                if (manualRelease) {
                    await this.applyManualRelease(result, manualRelease);
                }
            }
            return;
        }

        if (this.lastKnownRelease !== result.highestRelease) {
            this.lastKnownRelease = result.highestRelease;
            this.lastProvisionedRelease = undefined;
            this.promptedReleases.delete(result.highestRelease);
        }

        if (!this.lastProvisionedRelease) {
            this.statusBar.showDetectedRelease(result.highestRelease);
        }

        const shouldForce = reason === 'manual';
        if (shouldForce || !this.promptedReleases.has(result.highestRelease)) {
            await this.promptProvisioning(result, { force: shouldForce });
        }
    }

    private async applyManualRelease(result: WorkspaceScanResult, release: string): Promise<void> {
        this.lastKnownRelease = release;
        this.lastProvisionedRelease = undefined;
        this.statusBar.showDetectedRelease(release);
        await this.promptProvisioning(
            {
                ...result,
                highestRelease: release,
            },
            { force: true },
        );
    }

    private async promptManualReleaseChoice(): Promise<string | undefined> {
        const quickPickItems: Array<vscode.QuickPickItem & { value: string }> = [
            { label: 'Java 25 (Preview)', description: 'Preview release', value: '25' },
            { label: 'Java 21 (LTS)', description: 'Recommended Long-Term Support release', value: '21' },
            { label: 'Java 17 (LTS)', description: 'Widely supported Long-Term Support release', value: '17' },
            { label: 'Java 11 (LTS)', description: 'Legacy Long-Term Support release', value: '11' },
            { label: 'Java 8 (LTS)', description: 'Legacy release for older workloads', value: '8' },
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select the Java release to provision',
        });

        return selection?.value;
    }

    public async showQuickActions(scanner: WorkspaceScanner): Promise<void> {
        const actions: Array<vscode.QuickPickItem & { run: () => Promise<void> }> = [
            {
                label: '$(refresh) Rescan workspace',
                description: 'Detect pom.xml files and recompute the highest Java release',
                run: async () => {
                    await scanner.manualScan(true);
                },
            },
            {
                label: '$(cloud-download) Provision or update JDK',
                description: 'Guided provisioning flow based on the detected Java release',
                run: async () => {
                    const detection = await scanner.manualScan(false);
                    await this.handleDetection(detection, 'manual');
                },
            },
            {
                label: '$(info) Show current status',
                description: 'Display the last detected release and provisioning source',
                run: async () => {
                    const release = this.statusBar.getLastKnownRelease();
                    const source = this.statusBar.getLastKnownSource();
                    if (!release) {
                        await vscode.window.showInformationMessage('Jaenvtix has not detected any Java release yet.');
                        return;
                    }
                    const sourceDescription = source ? ` via ${source}` : '';
                    await vscode.window.showInformationMessage(`Active JDK: ${release}${sourceDescription}`);
                },
            },
        ];

        const selection = await vscode.window.showQuickPick(actions, {
            placeHolder: 'Jaenvtix quick actions',
        });

        if (selection) {
            await selection.run();
        }
    }

    private async promptProvisioning(result: WorkspaceScanResult, options?: { force?: boolean }): Promise<void> {
        const release = result.highestRelease;
        if (!release) {
            return;
        }

        if (!options?.force && this.promptedReleases.has(release)) {
            return;
        }

        this.promptedReleases.add(release);

        const message = `Jaenvtix detected Java release ${release}. Would you like to provision or link a matching JDK now?`;
        const selection = await vscode.window.showInformationMessage(
            message,
            'Provision automatically',
            'Use existing JDK',
            'Skip for now',
        );

        if (!selection || selection === 'Skip for now') {
            this.statusBar.showDetectedRelease(release);
            return;
        }

        if (selection === 'Provision automatically') {
            const provisionOptions: Array<vscode.QuickPickItem & { label: string; detail: string }> = [
                {
                    label: 'Oracle JDK (recommended)',
                    detail: 'Downloads Oracle builds when license automation is available.',
                },
                {
                    label: 'OpenJDK fallback',
                    detail: 'Uses a community distribution such as Amazon Corretto or Temurin.',
                },
            ];

            const provisionSelection = await vscode.window.showQuickPick(provisionOptions, {
                placeHolder: `Select the distribution for Java ${release}`,
            });

            if (provisionSelection) {
                this.lastProvisionedRelease = release;
                this.statusBar.showProvisioned(release, provisionSelection.label);
                await vscode.window.showInformationMessage(
                    `Jaenvtix will provision ${provisionSelection.label} for Java ${release}.`,
                );
            } else {
                this.statusBar.showDetectedRelease(release);
            }

            return;
        }

        if (selection === 'Use existing JDK') {
            const existingOptions: Array<vscode.QuickPickItem & { value: string }> = [
                {
                    label: '$(file-directory) Browse for JAVA_HOME…',
                    description: 'Select a local installation to bind to this workspace',
                    value: 'browse',
                },
                {
                    label: '$(gear) Enter path manually…',
                    description: 'Type the path to the desired JDK',
                    value: 'manual',
                },
            ];

            const existingSelection = await vscode.window.showQuickPick(existingOptions, {
                placeHolder: 'Connect to an existing JDK installation',
            });

            if (!existingSelection) {
                this.statusBar.showDetectedRelease(release);
                return;
            }

            if (existingSelection.value === 'manual') {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter the absolute path to the JDK you would like to use',
                    placeHolder: '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home',
                });
                if (input) {
                    this.lastProvisionedRelease = release;
                    this.statusBar.showProvisioned(release, `Existing (${input})`);
                    await vscode.window.showInformationMessage(`Jaenvtix will use the JDK at ${input}.`);
                } else {
                    this.statusBar.showDetectedRelease(release);
                }
            } else {
                this.lastProvisionedRelease = release;
                this.statusBar.showProvisioned(release, 'Existing (selected path)');
                await vscode.window.showInformationMessage('Jaenvtix will prompt you to pick a folder in a future version.');
            }
        }
    }

    public dispose(): void {
        // Currently no resources to dispose.
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Jaenvtix extension activating…');

    const statusBarProvider = new StatusBarProvider();
    const provisioningService = new ProvisioningService(statusBarProvider);
    const scanner = new WorkspaceScanner(async (result, reason) => {
        await provisioningService.handleDetection(result, reason);
    });

    context.subscriptions.push(statusBarProvider, provisioningService, scanner);

    const detectCommand = vscode.commands.registerCommand('jaenvtix.detectJavaVersion', async () => {
        const result = await scanner.manualScan(false);
        await provisioningService.handleDetection(result, 'manual');
    });

    const provisionCommand = vscode.commands.registerCommand('jaenvtix.provisionOrUpdateJdk', async () => {
        const result = await scanner.manualScan(false);
        await provisioningService.handleDetection(result, 'manual');
    });

    const statusCommand = vscode.commands.registerCommand('jaenvtix.showJdkStatus', async () => {
        await provisioningService.showQuickActions(scanner);
    });

    context.subscriptions.push(detectCommand, provisionCommand, statusCommand);

    await scanner.triggerInitialScan();

    console.log('Jaenvtix extension activated.');
}

export function deactivate(): void {
    // No-op for now – resources are disposed via subscriptions.
}
