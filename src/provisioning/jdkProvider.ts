import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { spawn } from 'child_process';

export type ChecksumPolicy = 'strict' | 'best-effort';

export type VendorPreference =
    | 'oracle'
    | 'corretto'
    | 'temurin'
    | 'zulu'
    | 'dragonwell'
    | 'sapmachine';

const DISTRIBUTION_MAP: Record<VendorPreference, string> = {
    oracle: 'oracle_openjdk',
    corretto: 'amazon_corretto',
    temurin: 'temurin',
    zulu: 'zulu',
    dragonwell: 'dragonwell',
    sapmachine: 'sap_machine',
};

const PLATFORM_MAP: Record<NodeJS.Platform, string> = {
    aix: 'linux',
    android: 'linux',
    cygwin: 'windows',
    darwin: 'macos',
    freebsd: 'linux',
    haiku: 'linux',
    linux: 'linux',
    netbsd: 'linux',
    openbsd: 'linux',
    sunos: 'linux',
    win32: 'windows',
};

const ARCH_MAP: Record<NodeJS.Architecture, string> = {
    arm: 'arm',
    arm64: 'aarch64',
    ia32: 'x86',
    loong64: 'loongarch64',
    mips: 'mips',
    mipsel: 'mipsel',
    ppc: 'ppc',
    ppc64: 'ppc64le',
    riscv64: 'riscv64',
    s390: 's390x',
    s390x: 's390x',
    x64: 'x64',
};

interface PackageMetadata {
    vendor: VendorPreference;
    url: string;
    checksum?: string;
    filename: string;
    version: string;
    requiresConsent: boolean;
    archiveType: 'zip' | 'tar.gz';
    humanVendorName: string;
}

export interface JdkProvisionResult {
    release: string;
    javaHome: string;
    installationRoot: string;
    vendor: string;
    version: string;
    downloadUrl: string;
    checksumValidated: boolean;
}

export interface ProvisioningOptions {
    release: string;
    preferOracle: boolean;
    fallbackVendor: VendorPreference;
    checksumPolicy: ChecksumPolicy;
    cleanupDownloads: boolean;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
}

interface InstallationManifest {
    release: string;
    javaHome: string;
    vendor: string;
    version: string;
    downloadUrl: string;
    checksumValidated: boolean;
    timestamp: number;
}

export class JdkProvider {
    private readonly cacheRoot = path.join(os.homedir(), '.jaenvtix');

    public async ensureInstalled(options: ProvisioningOptions): Promise<JdkProvisionResult> {
        const installationRoot = path.join(this.cacheRoot, options.release);
        await fs.mkdir(installationRoot, { recursive: true });

        const manifest = await this.readManifest(installationRoot);
        if (manifest) {
            const valid = await this.isJavaHome(manifest.javaHome);
            if (valid) {
                options.progress.report({ message: `Using cached JDK at ${manifest.javaHome}` });
                return {
                    release: options.release,
                    javaHome: manifest.javaHome,
                    installationRoot,
                    vendor: manifest.vendor,
                    version: manifest.version,
                    downloadUrl: manifest.downloadUrl,
                    checksumValidated: manifest.checksumValidated,
                };
            }
            await this.safeRemove(installationRoot);
            await fs.mkdir(installationRoot, { recursive: true });
        }

        const { metadata, usedVendor } = await this.resolveMetadata(options);

        if (!metadata) {
            throw new Error(
                'No compatible JDK package could be resolved. Configure jaenvtix.fallbackVendor or provision manually.',
            );
        }

        if (metadata.requiresConsent) {
            throw new Error(
                `${metadata.humanVendorName} requires manual license consent. Adjust settings or download manually.`,
            );
        }

        const archivePath = path.join(installationRoot, metadata.filename);
        const downloadResult = await this.downloadArtifact(metadata, archivePath, options);

        try {
            await this.extractArchive(archivePath, installationRoot, options);
        } finally {
            if (options.cleanupDownloads) {
                await fs.rm(archivePath, { force: true });
            }
        }

        const javaHome = await this.findJavaHome(installationRoot);
        if (!javaHome) {
            throw new Error(
                'Downloaded archive did not contain a recognizable JDK. Verify the package or install manually.',
            );
        }

        const result: JdkProvisionResult = {
            release: options.release,
            javaHome,
            installationRoot,
            vendor: this.describeVendor(usedVendor),
            version: metadata.version,
            downloadUrl: metadata.url,
            checksumValidated: downloadResult,
        };

        await this.writeManifest(installationRoot, result);

        return result;
    }

    public getInstallationRoot(release: string): string {
        return path.join(this.cacheRoot, release);
    }

    public async persistExternalInstallation(
        release: string,
        javaHome: string,
        vendorLabel: string,
    ): Promise<JdkProvisionResult> {
        const installationRoot = this.getInstallationRoot(release);
        await fs.mkdir(installationRoot, { recursive: true });

        const result: JdkProvisionResult = {
            release,
            javaHome,
            installationRoot,
            vendor: vendorLabel,
            version: release,
            downloadUrl: 'manual',
            checksumValidated: false,
        };

        await this.writeManifest(installationRoot, result);

        return result;
    }

    private async resolveMetadata(
        options: ProvisioningOptions,
    ): Promise<{ metadata: PackageMetadata | undefined; usedVendor: VendorPreference }> {
        const platformKey = os.platform() as NodeJS.Platform;
        const platform = PLATFORM_MAP[platformKey] ?? 'linux';
        const archKey = os.arch() as NodeJS.Architecture;
        const arch = ARCH_MAP[archKey] ?? 'x64';
        const preferOracle = options.preferOracle !== false;

        const attempted: Array<{ vendor: VendorPreference; reason?: string }> = [];

        if (preferOracle) {
            const oracle = await this.fetchPackage(options.release, 'oracle', platform, arch, options.token);
            if (oracle?.requiresConsent) {
                attempted.push({ vendor: 'oracle', reason: 'Oracle build requires manual license consent.' });
            } else if (oracle) {
                return { metadata: oracle, usedVendor: 'oracle' };
            } else {
                attempted.push({ vendor: 'oracle' });
            }
        }

        const fallbackVendor = options.fallbackVendor ?? 'corretto';
        const fallback = await this.fetchPackage(options.release, fallbackVendor, platform, arch, options.token);
        if (fallback) {
            return { metadata: fallback, usedVendor: fallbackVendor };
        }

        const messages = attempted
            .map((attempt) =>
                attempt.reason
                    ? `${this.describeVendor(attempt.vendor)}: ${attempt.reason}`
                    : `${this.describeVendor(attempt.vendor)}: package not available`,
            )
            .join('\n');
        if (messages) {
            console.warn('Jaenvtix JDK resolution attempts failed:\n' + messages);
        }

        return { metadata: undefined, usedVendor: fallbackVendor };
    }

    private describeVendor(vendor: VendorPreference): string {
        switch (vendor) {
            case 'oracle':
                return 'Oracle JDK';
            case 'corretto':
                return 'Amazon Corretto';
            case 'temurin':
                return 'Eclipse Temurin';
            case 'zulu':
                return 'Azul Zulu';
            case 'dragonwell':
                return 'Alibaba Dragonwell';
            case 'sapmachine':
                return 'SAP SapMachine';
            default:
                return vendor;
        }
    }

    private async fetchPackage(
        release: string,
        vendor: VendorPreference,
        platform: string,
        arch: string,
        token: vscode.CancellationToken,
    ): Promise<PackageMetadata | undefined> {
        const distro = DISTRIBUTION_MAP[vendor];
        const url = new URL('https://api.foojay.io/disco/v3.0/packages');
        url.searchParams.set('version', release);
        url.searchParams.set('package_type', 'jdk');
        url.searchParams.set('latest', 'true');
        url.searchParams.set('distro', distro);
        url.searchParams.set('architecture', arch);
        url.searchParams.set('os', platform);
        url.searchParams.set('archive_type', platform === 'windows' ? 'zip' : 'tar.gz');
        url.searchParams.set('page', '0');
        url.searchParams.set('page_size', '1');

        const controller = new AbortController();
        const subscription = token.onCancellationRequested(() => {
            controller.abort();
        });

        try {
            const response = await this.fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'jaenvtix-extension',
                    Accept: 'application/json',
                },
            });

            if (response.status === 451 || response.status === 403) {
                return {
                    vendor,
                    url: url.toString(),
                    checksum: undefined,
                    filename: `${vendor}-${release}.blocked`,
                    version: release,
                    requiresConsent: true,
                    archiveType: platform === 'windows' ? 'zip' : 'tar.gz',
                    humanVendorName: this.describeVendor(vendor),
                };
            }

            if (!response.ok) {
                console.warn(`Failed to fetch package metadata for vendor ${vendor}: ${response.statusText}`);
                return undefined;
            }

            const payload = (await response.json()) as { result?: Array<Record<string, unknown>> };
            const [first] = payload.result ?? [];
            if (!first) {
                return undefined;
            }

            const downloadUrl = typeof first.download_url === 'string' ? first.download_url : '';
            if (!downloadUrl) {
                return undefined;
            }

            const filename = path.basename(downloadUrl);
            const checksum = typeof first.sha256_hash === 'string' ? first.sha256_hash : undefined;
            const version = typeof first.java_version === 'string' ? first.java_version : release;
            const archiveType: 'zip' | 'tar.gz' = filename.endsWith('.zip') ? 'zip' : 'tar.gz';

            return {
                vendor,
                url: downloadUrl,
                checksum,
                filename,
                version,
                requiresConsent: false,
                archiveType,
                humanVendorName: this.describeVendor(vendor),
            };
        } catch (error) {
            if (controller.signal.aborted) {
                throw error;
            }
            console.warn(`Error fetching metadata from Foojay for vendor ${vendor}:`, error);
            return undefined;
        } finally {
            subscription.dispose();
        }
    }

    private async downloadArtifact(
        metadata: PackageMetadata,
        destination: string,
        options: ProvisioningOptions,
    ): Promise<boolean> {
        options.progress.report({ message: `Downloading ${metadata.humanVendorName} ${metadata.version}` });

        const controller = new AbortController();
        const subscription = options.token.onCancellationRequested(() => controller.abort());

        try {
            const response = await this.fetch(metadata.url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'jaenvtix-extension' },
            });

            if (!response.ok || !response.body) {
                throw new Error(
                    `Failed to download ${metadata.url}: ${response.status} ${response.statusText}. Manual installation may be required.`,
                );
            }

            const totalBytes = Number(response.headers.get('content-length') ?? 0);
            const nodeStream = this.toNodeStream(response.body as unknown as ReadableStream<Uint8Array>);
            let downloaded = 0;

            nodeStream.on('data', (chunk: Buffer) => {
                downloaded += chunk.length;
                if (totalBytes > 0) {
                    const percent = Math.min(100, (downloaded / totalBytes) * 100);
                    options.progress.report({ message: `Downloading… ${percent.toFixed(1)}%`, increment: 0 });
                }
            });

            await pipeline(nodeStream, createWriteStream(destination));

            if (metadata.checksum) {
                const valid = await this.validateChecksum(destination, metadata.checksum, options);
                if (!valid) {
                    throw new Error('Checksum verification failed. The downloaded JDK may be corrupted.');
                }
                return true;
            }

            if (options.checksumPolicy === 'strict') {
                throw new Error(
                    'Checksum information unavailable for the selected distribution. Adjust jaenvtix.checksumPolicy or install manually.',
                );
            }

            return false;
        } finally {
            subscription.dispose();
        }
    }

    private async validateChecksum(
        filePath: string,
        expected: string,
        options: ProvisioningOptions,
    ): Promise<boolean> {
        options.progress.report({ message: 'Validating checksum…' });
        const hash = createHash('sha256');
        const data = await fs.readFile(filePath);
        hash.update(data);
        const digest = hash.digest('hex');
        const normalizedExpected = expected.trim().toLowerCase();
        return digest === normalizedExpected;
    }

    private async extractArchive(
        archivePath: string,
        destination: string,
        options: ProvisioningOptions,
    ): Promise<void> {
        options.progress.report({ message: 'Extracting archive…' });

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

    private async findJavaHome(root: string): Promise<string | undefined> {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
            const candidate = path.join(root, entry.name);
            if (entry.isDirectory()) {
                const javaBin = path.join(candidate, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
                if (await this.exists(javaBin)) {
                    return candidate;
                }
                const nested = await this.findJavaHome(candidate);
                if (nested) {
                    return nested;
                }
            }
        }
        return undefined;
    }

    private async exists(target: string): Promise<boolean> {
        try {
            await fs.access(target);
            return true;
        } catch {
            return false;
        }
    }

    private async readManifest(dir: string): Promise<InstallationManifest | undefined> {
        const manifestPath = path.join(dir, 'installation.json');
        try {
            const content = await fs.readFile(manifestPath, 'utf-8');
            return JSON.parse(content) as InstallationManifest;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            console.warn('Failed to read JDK manifest', error);
            return undefined;
        }
    }

    private async writeManifest(dir: string, result: JdkProvisionResult): Promise<void> {
        const manifest: InstallationManifest = {
            release: result.release,
            javaHome: result.javaHome,
            vendor: result.vendor,
            version: result.version,
            downloadUrl: result.downloadUrl,
            checksumValidated: result.checksumValidated,
            timestamp: Date.now(),
        };
        const manifestPath = path.join(dir, 'installation.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, undefined, 2), 'utf-8');
    }

    private async isJavaHome(javaHome: string): Promise<boolean> {
        const javaBin = path.join(javaHome, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
        return this.exists(javaBin);
    }

    private async safeRemove(dir: string): Promise<void> {
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Failed to clean directory ${dir}`, error);
        }
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
