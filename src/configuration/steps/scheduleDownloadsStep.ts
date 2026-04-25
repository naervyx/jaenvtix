import {ArchitectureType, PlatformType} from '../../core/system';
import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {hasJdkInstallation, hasMavenInstallation} from '../../build/directory';
import {downloadFile, DownloadOptions, DownloadResult} from '../../file/fileDownload';
import {Messages} from '../../util/message';
import {getJdkDistribution} from '../../build/javaUrl';
import type {JdkDistribution} from '../../build/javaUrl';

export interface ScheduleDownloadsDeps {
    /** Override the JDK distribution resolver. Defaults to the live network one. */
    getJdkDistribution?: (
        version: string, platform: PlatformType, arch: ArchitectureType
    ) => Promise<JdkDistribution | null>;
    /** Override the file downloader. Defaults to the real HTTP downloader. */
    downloadFile?: (options: DownloadOptions) => Promise<DownloadResult>;
}

export class ScheduleDownloadsStep implements ConfigurationStep {
    readonly name = 'ScheduleDownloads';

    constructor(private readonly deps: ScheduleDownloadsDeps = {}) {}

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        const fetchJdk = this.deps.getJdkDistribution ?? getJdkDistribution;
        const startDownload = this.deps.downloadFile ?? downloadFile;

        if (!state.platform || !state.arch || !state.mavenDistribution) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM_ARCH_MAVEN);
        }

        let needsMavenDownload = false;

        for (const [javaVersion, paths] of state.versionPaths) {
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
}
