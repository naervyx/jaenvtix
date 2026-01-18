import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {DownloadResult} from '../../util/fileDownload';
import {hasJdkInstallation, hasMavenInstallation} from '../../build/directory';
import {extractTarGz} from '../../util/tarGz';
import {extractZip} from '../../util/zip';
import {Messages} from '../../util/message';

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

        for (const [javaVersion, paths] of state.versionPaths) {
            const jdkDownloadPromise = state.jdkDownloads.get(javaVersion);

            if (jdkDownloadPromise) {
                const jdkResult = await jdkDownloadPromise;
                if (jdkResult.success) {
                    await extractArchive(jdkResult, paths.jdkHome);
                }
            } else if (!hasJdkInstallation(paths.jdkHome, state.platform)) {
                return StepResult.error(Messages.Error.JDK_NOT_AVAILABLE(javaVersion));
            }

            if (mavenResult && !hasMavenInstallation(paths.toolBin, state.platform)) {
                await extractArchive(mavenResult, paths.toolHome);
            }

            if (!hasJdkInstallation(paths.jdkHome, state.platform)) {
                return StepResult.error(Messages.Error.JDK_EXTRACTION_FAILED(javaVersion));
            }

            if (!hasMavenInstallation(paths.toolBin, state.platform)) {
                return StepResult.error(Messages.Error.MAVEN_EXTRACTION_FAILED(javaVersion));
            }
        }

        return StepResult.success();
    }
}
