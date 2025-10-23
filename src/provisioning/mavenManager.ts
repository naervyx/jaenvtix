import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';

const MVND_VERSION = '1.0.2';

interface MvndMetadata {
    url: string;
    filename: string;
    archiveType: 'zip' | 'tar.gz';
}

export class MavenManager {
    public async ensureWrapper(installationRoot: string, javaHome: string): Promise<string> {
        const binDir = path.join(installationRoot, 'bin');
        await fs.mkdir(binDir, { recursive: true });

        if (os.platform() === 'win32') {
            const cmdPath = path.join(binDir, 'mvn-jaenvtix.cmd');
            const cmdContent = [
                '@echo off',
                `set "JAVA_HOME=${javaHome.replace(/"/g, '""')}"`,
                'set "PATH=%JAVA_HOME%\\bin;%PATH%"',
                'mvn %*',
            ].join('\r\n');
            await fs.writeFile(cmdPath, cmdContent, 'utf-8');

            const ps1Path = path.join(binDir, 'mvn-jaenvtix.ps1');
            const escapedJavaHome = javaHome.replace(/`/g, '``');
            const psContent = [
                '$ErrorActionPreference = "Stop"',
                `$env:JAVA_HOME = "${escapedJavaHome}"`,
                '$env:PATH = "$env:JAVA_HOME\\bin;" + $env:PATH',
                '& mvn @args',
                'exit $LASTEXITCODE',
            ].join(os.EOL);
            await fs.writeFile(ps1Path, psContent, 'utf-8');
            return cmdPath;
        }

        const wrapperPath = path.join(binDir, 'mvn-jaenvtix');
        const content = `#!/usr/bin/env bash\nset -euo pipefail\nexport JAVA_HOME="${javaHome.replace(/"/g, '\\"')}"\nexport PATH="$JAVA_HOME/bin:$PATH"\nexec mvn "$@"\n`;
        await fs.writeFile(wrapperPath, content, { encoding: 'utf-8', mode: 0o755 });
        await fs.chmod(wrapperPath, 0o755);
        return wrapperPath;
    }

    public async reinstallMvnd(
        installationRoot: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const metadata = this.resolveMvndMetadata();
        const downloadDir = path.join(installationRoot, 'mvnd');
        await fs.rm(downloadDir, { force: true, recursive: true }).catch(() => undefined);
        await fs.mkdir(downloadDir, { recursive: true });
        const archivePath = path.join(downloadDir, metadata.filename);

        progress.report({ message: 'Downloading Apache mvnd…' });
        const controller = new AbortController();
        const subscription = token.onCancellationRequested(() => controller.abort());

        try {
            const response = await this.fetch(metadata.url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'jaenvtix-extension' },
            });

            if (!response.ok || !response.body) {
                throw new Error(
                    `Failed to download mvnd from ${metadata.url}: ${response.status} ${response.statusText}. Install manually from https://maven.apache.org/mvnd/.`,
                );
            }

            const totalBytes = Number(response.headers.get('content-length') ?? 0);
            const nodeStream = this.toNodeStream(response.body as unknown as ReadableStream<Uint8Array>);
            let downloaded = 0;
            nodeStream.on('data', (chunk: Buffer) => {
                downloaded += chunk.length;
                if (totalBytes > 0) {
                    const percent = Math.min(100, (downloaded / totalBytes) * 100);
                    progress.report({ message: `Downloading mvnd… ${percent.toFixed(1)}%`, increment: 0 });
                }
            });

            await pipeline(nodeStream, createWriteStream(archivePath));
        } finally {
            subscription.dispose();
        }

        progress.report({ message: 'Extracting mvnd…' });
        await this.extractArchive(archivePath, downloadDir);
        await fs.rm(archivePath, { force: true }).catch(() => undefined);

        const mvndHome = await this.findMvndHome(downloadDir);
        if (!mvndHome) {
            throw new Error(
                'mvnd archive extracted but binaries were not found. Download and install mvnd manually from https://maven.apache.org/mvnd/.',
            );
        }

        return mvndHome;
    }

    private resolveMvndMetadata(): MvndMetadata {
        const platform = os.platform();
        const arch = os.arch();

        if (platform === 'win32') {
            return {
                url: `https://downloads.apache.org/maven/mvnd/${MVND_VERSION}/apache-mvnd-${MVND_VERSION}-windows-amd64.zip`,
                filename: `apache-mvnd-${MVND_VERSION}-windows-amd64.zip`,
                archiveType: 'zip',
            };
        }

        if (platform === 'darwin') {
            const suffix = arch === 'arm64' ? 'macos-aarch64' : 'macos-amd64';
            return {
                url: `https://downloads.apache.org/maven/mvnd/${MVND_VERSION}/apache-mvnd-${MVND_VERSION}-${suffix}.zip`,
                filename: `apache-mvnd-${MVND_VERSION}-${suffix}.zip`,
                archiveType: 'zip',
            };
        }

        const suffix = arch === 'arm64' ? 'linux-aarch64' : 'linux-amd64';
        return {
            url: `https://downloads.apache.org/maven/mvnd/${MVND_VERSION}/apache-mvnd-${MVND_VERSION}-${suffix}.tar.gz`,
            filename: `apache-mvnd-${MVND_VERSION}-${suffix}.tar.gz`,
            archiveType: 'tar.gz',
        };
    }

    private async extractArchive(archivePath: string, destination: string): Promise<void> {
        if (os.platform() === 'win32' && archivePath.endsWith('.zip')) {
            await this.runCommand('powershell', [
                '-NoLogo',
                '-NoProfile',
                '-Command',
                `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
            ]);
            return;
        }

        if (archivePath.endsWith('.zip')) {
            await this.runCommand('unzip', ['-o', archivePath, '-d', destination]);
            return;
        }

        await this.runCommand('tar', ['-xzf', archivePath, '-C', destination]);
    }

    private async runCommand(command: string, args: string[]): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, { stdio: 'inherit' });
            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`${command} exited with code ${code}`));
                }
            });
        });
    }

    private async findMvndHome(root: string): Promise<string | undefined> {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
            const candidate = path.join(root, entry.name);
            if (entry.isDirectory()) {
                const binaryName = os.platform() === 'win32' ? 'mvnd.cmd' : 'mvnd';
                const candidateBinary = path.join(candidate, 'bin', binaryName);
                try {
                    await fs.access(candidateBinary);
                    return candidate;
                } catch {
                    const nested = await this.findMvndHome(candidate);
                    if (nested) {
                        return nested;
                    }
                }
            }
        }
        return undefined;
    }

    private fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const fn = globalThis.fetch;
        if (typeof fn !== 'function') {
            throw new Error('Fetch API is not available in this environment.');
        }
        return fn.call(globalThis, input, init);
    }

    private toNodeStream(stream: ReadableStream<Uint8Array>): NodeJS.ReadableStream {
        const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => NodeJS.ReadableStream }).fromWeb;
        if (typeof fromWeb === 'function') {
            return fromWeb(stream as unknown);
        }

        const reader = stream.getReader();
        return new Readable({
            async read() {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        this.push(null);
                    } else {
                        this.push(Buffer.from(value));
                    }
                } catch (error) {
                    this.destroy(error as Error);
                }
            },
        });
    }
}
