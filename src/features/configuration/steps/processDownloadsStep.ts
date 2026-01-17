import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {DownloadResult} from '../../../util/fileDownload';
import {extractTarGz} from '../../unpacker/tarGz';
import {extractZip} from '../../unpacker/zip';

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
        const allDownloads: Promise<DownloadResult>[] = [
            ...state.jdkDownloadCache.values(),
            ...state.mavenDownloadCache.values(),
        ];

        if (allDownloads.length === 0) {
            return StepResult.success();
        }

        const results = await Promise.all(allDownloads);
        const failed = results.find(isFailure);
        if (failed) {
            return StepResult.error(`Download failed: ${failed.error ?? 'Unknown error'}`);
        }

        for (const [javaVersion, paths] of state.versionPaths) {
            const jdkDownloadPromise = state.jdkDownloadCache.get(javaVersion);
            const mavenDownloadPromise = state.mavenDownloadCache.get(javaVersion);

            if (jdkDownloadPromise) {
                const jdkResult = await jdkDownloadPromise;
                if (jdkResult.success) {
                    await extractArchive(jdkResult, paths.jdkHome);
                }
            }

            if (mavenDownloadPromise) {
                const mavenResult = await mavenDownloadPromise;
                if (mavenResult.success) {
                    await extractArchive(mavenResult, paths.toolHome);
                }
            }
        }

        return StepResult.success();
    }
}
