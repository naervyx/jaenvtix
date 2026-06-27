import {promises as fs} from 'node:fs';

import {ArchitectureType, PlatformType} from '../../core/system';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {hasJdkInstallation, hasMavenInstallation} from '../../build/directory';
import {downloadFile, DownloadOptions, DownloadResult} from '../../file/fileDownload';
import {Messages} from '../../util/message';
import {getJdkDistribution} from '../../build/javaUrl';
import type {JdkDistribution, JdkVendor} from '../../build/javaUrl';
import {fetchLatestJdkVersion} from '../../build/vendorApiResolvers';
import {
    buildVersionInfoFromDisk,
    isNewerVersion,
    readVersionInfo,
    shouldCheckForUpdate,
    touchLastChecked,
} from '../../build/versionTracking';
import {log} from '../../util/logger';

export interface ScheduleDownloadsDeps {
    /** Override the JDK distribution resolver. Defaults to the live network one. */
    getJdkDistribution?: (
        version: string, platform: PlatformType, arch: ArchitectureType
    ) => Promise<JdkDistribution | null>;
    /** Override the file downloader. Defaults to the real HTTP downloader. */
    downloadFile?: (options: DownloadOptions) => Promise<DownloadResult>;
    /**
     * Reads `jaenvtix.autoUpdatePatches`; the orchestrator wires the real
     * configuration. Defaults to enabled (the setting's default).
     */
    isAutoUpdateEnabled?: () => boolean;
    /** Override the vendor "latest version" lookup. Defaults to the live APIs. */
    fetchLatestJdkVersion?: (vendor: JdkVendor, javaVersion: string) => Promise<string | null>;
}

/**
 * Determines which JDK and Maven archives need to be downloaded, then fires
 * the download promises without awaiting them (scheduling).
 *
 * Business rules:
 * - A JDK download is scheduled for a version only when the Jaenvtix cache slot
 *   does not already contain a valid JDK installation. Already-installed JDKs
 *   detected in `DetectInstalledJdksStep` are skipped too (they live outside
 *   the Jaenvtix cache but are checked via `hasJdkInstallation`).
 * - Maven is NOT downloaded when every project in the workspace ships its own
 *   `mvnw`. In that case `state.mavenDownload` remains undefined and subsequent
 *   steps skip Maven-related work accordingly.
 * - Returns a warning (not an error) when a JDK distribution cannot be resolved,
 *   because the user may still be able to configure the project manually.
 * - Security patch refresh: before reusing a cached Jaenvtix JDK, a
 *   rate-limited (24h) check against the vendor's API may delete the slot so
 *   a newer patch is downloaded — see `maybeInvalidateStaleJdk`.
 * - Accepts `deps` for dependency injection to allow unit testing without network access.
 */
export class ScheduleDownloadsStep implements ConfigurationStep {
    readonly name = 'ScheduleDownloads';

    constructor(private readonly deps: ScheduleDownloadsDeps = {}) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const fetchJdk = this.deps.getJdkDistribution ?? getJdkDistribution;
        const startDownload = this.deps.downloadFile ?? downloadFile;

        if (!state.platform || !state.arch || !state.mavenDistribution) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM_ARCH_MAVEN);
        }

        // When every project ships its own `mvnw`, the Jaenvtix Maven is
        // never invoked. Avoid downloading and extracting it in that case —
        // the wrapper script generation step also short-circuits, and the
        // settings step already leaves `maven.executable.path` unset.
        const projectsWithVersion = [...state.projectVersionMap.values()].flat();
        const everyProjectHasMvnw =
            projectsWithVersion.length > 0 &&
            projectsWithVersion.every((project) => state.projectsHasMvnw.get(project) === true);

        let needsMavenDownload = false;

        for (const [javaVersion, paths] of state.versionPaths) {
            // Detected system JDKs are never auto-updated: Jaenvtix only
            // manages its own cache slots, never system installations.
            if (!state.detectedJdks.has(javaVersion) && this.deps.isAutoUpdateEnabled?.() !== false) {
                await this.maybeInvalidateStaleJdk(javaVersion, paths.jdkHome, state.platform);
            }

            const hasJdkHome = hasJdkInstallation(paths.jdkHome, state.platform);
            if (!hasJdkHome && !state.jdkDownloads.has(javaVersion)) {
                const jdkDistribution = await fetchJdk(javaVersion, state.platform, state.arch);
                if (!jdkDistribution) {
                    return StepResult.warning(Messages.Warning.JDK_DISTRIBUTION_NOT_FOUND);
                }

                const jdkDownloadPromise = startDownload({
                    url: jdkDistribution.url,
                    fileName: jdkDistribution.name,
                    extension: jdkDistribution.extension,
                });

                state.jdkDownloads.set(javaVersion, jdkDownloadPromise);
            }

            if (everyProjectHasMvnw) {
                continue;
            }

            const hasToolHome = hasMavenInstallation(paths.toolBin, state.platform);
            if (!hasToolHome) {
                needsMavenDownload = true;
            }
        }

        if (needsMavenDownload && !state.mavenDownload) {
            state.mavenDownload = startDownload({
                url: state.mavenDistribution.url,
                fileName: state.mavenDistribution.name,
                extension: state.mavenDistribution.extension,
            });
        }

        return StepResult.success();
    }

    /**
     * Deletes the cached JDK slot when the vendor published a newer patch, so
     * the normal scheduling below re-downloads it (picking up security fixes).
     *
     * Business rules:
     * - Rate-limited: runs at most once per 24h per slot (`checkedAt` stamp).
     * - Slots without metadata (downloaded before version tracking existed)
     *   are bootstrapped from the JDK's own `release` file; when even that
     *   fails, the slot is left alone — never delete what we can't identify.
     * - A failed/unsupported "latest" lookup only re-stamps `checkedAt`.
     * - Deleting the slot also removes the co-located Maven (`mvn-custom/`);
     *   the scheduling loop re-downloads it together with the JDK.
     */
    private async maybeInvalidateStaleJdk(
        javaVersion: string,
        jdkHome: string,
        platform: PlatformType,
    ): Promise<void> {
        if (!hasJdkInstallation(jdkHome, platform)) {
            return;
        }

        // checkedAt 0 on bootstrap → the very first run checks immediately.
        const info = readVersionInfo(jdkHome) ?? buildVersionInfoFromDisk(jdkHome, 0);
        if (!info || !shouldCheckForUpdate(info)) {
            return;
        }

        const fetchLatest = this.deps.fetchLatestJdkVersion ?? fetchLatestJdkVersion;
        const latest = await fetchLatest(info.vendor, javaVersion);
        if (!latest || !isNewerVersion(latest, info.fullVersion)) {
            touchLastChecked(jdkHome, info);
            return;
        }

        log(Messages.Log.JDK_PATCH_UPDATE(javaVersion, info.fullVersion, latest));
        try {
            await fs.rm(jdkHome, {recursive: true, force: true});
        } catch {
            // A locked file (e.g. a running java.exe) must not abort the
            // pipeline; the slot stays as-is and the check retries next window.
            touchLastChecked(jdkHome, info);
        }
    }
}
