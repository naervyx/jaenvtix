import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {DownloadResult} from '../../file/fileDownload';
import {hasJdkInstallation, hasMavenInstallation} from '../../build/directory';
import {extractTarGz} from '../../file/unpacker/tarGz';
import {extractZip} from '../../file/unpacker/zip';
import type {PlatformType} from '../../core/system';
import {Messages} from '../../util/message';

async function removeIfExists(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            console.warn(Messages.Warning.TEMP_CLEANUP_FAILED(filePath, (error as Error).message));
        }
    }
}

function isFailure(result: DownloadResult): result is DownloadResult & { success: false } {
    return !result.success;
}

async function extractArchive(result: DownloadResult, targetPath: string): Promise<void> {
    if (result.filePath.endsWith('.tar.gz')) {
        await extractTarGz(result.filePath, targetPath);
        return;
    }

    if (result.filePath.endsWith('.zip')) {
        await extractZip(result.filePath, targetPath);
    }
}

/**
 * Defensive fallback for Linux / macOS: after extraction, ensure every file
 * under `<root>/bin` is executable. Covers edge cases where the archive did
 * not carry mode bits (e.g. a zip extracted on Unix) or where an entry's
 * mode was zero. Best-effort — a missing directory or a single chmod failure
 * must not abort the configuration pipeline.
 */
async function ensureBinDirectoryExecutable(root: string, platform: PlatformType): Promise<void> {
    if (platform === 'windows') {
        return;
    }

    const binPath = join(root, 'bin');

    let entries: string[];
    try {
        entries = await fs.readdir(binPath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return;
        }
        console.warn(`[jaenvtix] Could not list ${binPath}: ${(error as Error).message}`);
        return;
    }

    await Promise.all(entries.map(async (entry) => {
        const filePath = join(binPath, entry);
        try {
            const stat = await fs.stat(filePath);
            if (stat.isFile()) {
                await fs.chmod(filePath, 0o755);
            }
        } catch {
            // Best-effort: ignore per-file failures.
        }
    }));
}

export class ProcessDownloadsStep implements ConfigurationStep {
    readonly name = 'ProcessDownloads';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM);
        }

        const allDownloads: Promise<DownloadResult>[] = [
            ...state.jdkDownloads.values(),
            ...(state.mavenDownload ? [state.mavenDownload] : []),
        ];

        if (allDownloads.length > 0) {
            const results = await Promise.all(allDownloads);
            const failed = results.find(isFailure);
            if (failed) {
                return StepResult.error(Messages.Error.DOWNLOAD_FAILED(failed.error));
            }
        }

        const mavenResult = state.mavenDownload ? await state.mavenDownload : undefined;

        const extractedArchives = new Set<string>();

        for (const [javaVersion, paths] of state.versionPaths) {
            const jdkDownloadPromise = state.jdkDownloads.get(javaVersion);

            if (jdkDownloadPromise) {
                const jdkResult = await jdkDownloadPromise;
                if (jdkResult.success) {
                    await extractArchive(jdkResult, paths.jdkHome);
                    extractedArchives.add(jdkResult.filePath);
                    await ensureBinDirectoryExecutable(paths.jdkHome, state.platform);
                }
            } else if (!hasJdkInstallation(paths.jdkHome, state.platform)) {
                return StepResult.error(Messages.Error.JDK_NOT_AVAILABLE(javaVersion));
            }

            if (mavenResult && !hasMavenInstallation(paths.toolBin, state.platform)) {
                await extractArchive(mavenResult, paths.toolHome);
                extractedArchives.add(mavenResult.filePath);
                await ensureBinDirectoryExecutable(paths.toolHome, state.platform);
            }

            if (!hasJdkInstallation(paths.jdkHome, state.platform)) {
                return StepResult.error(Messages.Error.JDK_EXTRACTION_FAILED(javaVersion));
            }

            if (!hasMavenInstallation(paths.toolBin, state.platform)) {
                return StepResult.error(Messages.Error.MAVEN_EXTRACTION_FAILED(javaVersion));
            }
        }

        await Promise.all([...extractedArchives].map(removeIfExists));

        return StepResult.success();
    }
}
