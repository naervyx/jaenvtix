import {promises as fs} from 'node:fs';
import {join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {DownloadResult} from '../../file/fileDownload';
import {hasJdkInstallation, hasMavenInstallation, resolveJdkInstallationHome} from '../../build/directory';
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

function isFailure(result: DownloadResult): result is DownloadResult & {success: false} {
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
export async function ensureBinDirectoryExecutable(root: string, platform: PlatformType): Promise<void> {
    if (platform === 'windows') {
        return;
    }

    const binPath = join(root, 'bin');

    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(binPath, {recursive: true, withFileTypes: true});
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return;
        }
        console.warn(`[jaenvtix] Could not list ${binPath}: ${(error as Error).message}`);
        return;
    }

    await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile()) {
            return;
        }
        // `entry.parentPath` is the absolute directory holding `entry.name`.
        // Falls back to `entry.path` (deprecated alias) for older Node 20 minor
        // versions where `parentPath` is not yet exposed.
        const parentDir = (entry as {parentPath?: string; path?: string}).parentPath
            ?? (entry as {path?: string}).path
            ?? binPath;
        const filePath = join(parentDir, entry.name);
        try {
            await fs.chmod(filePath, 0o755);
        } catch {
            // Best-effort: ignore per-file failures.
        }
    }));
}

/**
 * Awaits all in-flight download promises, extracts the archives to their target
 * paths, ensures executable permissions, and cleans up temp files.
 *
 * Business rules:
 * - Awaits all JDK and Maven downloads in parallel (`Promise.all`) before starting
 *   extraction, so a single failure short-circuits without partial extractions.
 * - Each JDK version is extracted only once per `jdkHome` path, even when shared
 *   across multiple projects.
 * - After extraction, `paths.jdkHome` is normalized to the directory that
 *   actually contains `bin/java`: macOS archives extract as a bundle
 *   (`Contents/Home`), so the cache slot path alone would point downstream
 *   steps (settings, toolchains, wrapper scripts) at an invalid Java home.
 *   Steps that consume `jdkHome` must therefore run after this one.
 * - Maven is extracted into each version's `toolHome` independently, because Maven
 *   is co-located with the JDK cache slot.
 * - Calls `ensureBinDirectoryExecutable` after each extraction on POSIX systems.
 * - Temp archive files are deleted after all extractions complete.
 * - When `state.mavenDownload` is undefined (no Maven was downloaded because all
 *   projects ship `mvnw`), a missing Maven installation is not treated as an error.
 */
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
                }
            } else if (!hasJdkInstallation(paths.jdkHome, state.platform)) {
                return StepResult.error(Messages.Error.JDK_NOT_AVAILABLE(javaVersion));
            }

            if (mavenResult && !hasMavenInstallation(paths.toolBin, state.platform)) {
                await extractArchive(mavenResult, paths.toolHome);
                extractedArchives.add(mavenResult.filePath);
                await ensureBinDirectoryExecutable(paths.toolHome, state.platform);
            }

            const resolvedJdkHome = resolveJdkInstallationHome(paths.jdkHome, state.platform);
            if (!resolvedJdkHome) {
                return StepResult.error(Messages.Error.JDK_EXTRACTION_FAILED(javaVersion));
            }

            // Point downstream consumers (settings, toolchains, wrappers) at
            // the directory that actually contains bin/java — on macOS that is
            // <slot>/Contents/Home, not the cache slot itself.
            paths.jdkHome = resolvedJdkHome;

            if (jdkDownloadPromise) {
                await ensureBinDirectoryExecutable(resolvedJdkHome, state.platform);
            }

            // When `state.mavenDownload` is undefined the schedule step
            // decided no Maven download was needed (every project ships its
            // own `mvnw`). In that case, missing Maven in the cache is
            // expected — not a failure.
            if (state.mavenDownload && !hasMavenInstallation(paths.toolBin, state.platform)) {
                return StepResult.error(Messages.Error.MAVEN_EXTRACTION_FAILED(javaVersion));
            }
        }

        await Promise.all([...extractedArchives].map(removeIfExists));

        return StepResult.success();
    }
}
