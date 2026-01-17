import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {directoryHasContent} from '../../build/directory';
import {downloadFile} from '../../../util/fileDownload';
import {Messages} from '../../../util/message';
import {getJdkDistribution} from '../../build/javaUrl';

export class ScheduleDownloadsStep implements ConfigurationStep {
    readonly name = 'ScheduleDownloads';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.platform || !state.arch || !state.mavenDistribution) {
            return StepResult.error('Missing platform, architecture, or Maven distribution information');
        }

        for (const [javaVersion, paths] of state.versionPaths) {
            const hasJdkHome = directoryHasContent(paths.jdkHome);
            if (!hasJdkHome) {
                const jdkDistribution = await getJdkDistribution(javaVersion, state.platform, state.arch);
                if (!jdkDistribution) {
                    return StepResult.warning(Messages.Warning.JDK_DISTRIBUTION_NOT_FOUND);
                }

                const jdkDownloadPromise = downloadFile({
                    url: jdkDistribution.url,
                    fileName: jdkDistribution.name,
                    extension: jdkDistribution.extension,
                });

                state.jdkDownloadCache.set(javaVersion, jdkDownloadPromise);
            }

            const hasToolHome = directoryHasContent(paths.toolHome);
            if (!hasToolHome) {
                const mavenDownloadPromise = downloadFile({
                    url: state.mavenDistribution.url,
                    fileName: state.mavenDistribution.name,
                    extension: state.mavenDistribution.extension,
                });

                state.mavenDownloadCache.set(javaVersion, mavenDownloadPromise);
            }
        }

        return StepResult.success();
    }
}
