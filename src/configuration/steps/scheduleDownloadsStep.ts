import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {hasJdkInstallation, hasMavenInstallation} from '../../build/directory';
import {downloadFile} from '../../file/fileDownload';
import {Messages} from '../../util/message';
import {getJdkDistribution} from '../../build/javaUrl';

export class ScheduleDownloadsStep implements ConfigurationStep {
    readonly name = 'ScheduleDownloads';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform || !state.arch || !state.mavenDistribution) {
            return StepResult.error(Messages.Error.MISSING_PLATFORM_ARCH_MAVEN);
        }

        let needsMavenDownload = false;

        for (const [javaVersion, paths] of state.versionPaths) {
            const hasJdkHome = hasJdkInstallation(paths.jdkHome, state.platform);
            if (!hasJdkHome && !state.jdkDownloads.has(javaVersion)) {
                const jdkDistribution = await getJdkDistribution(javaVersion, state.platform, state.arch);
                if (!jdkDistribution) {
                    return StepResult.warning(Messages.Warning.JDK_DISTRIBUTION_NOT_FOUND);
                }

                const jdkDownloadPromise = downloadFile({
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
            state.mavenDownload = downloadFile({
                url: state.mavenDistribution.url,
                fileName: state.mavenDistribution.name,
                extension: state.mavenDistribution.extension,
            });
        }

        return StepResult.success();
    }
}
