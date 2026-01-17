import * as vscode from 'vscode';

import {Messages} from './util/message';
import {findProjectsWithPom} from './features/search/pom';
import {parseJavaVersionFromPom} from './features/search/javaVersion';
import {getArchitecture, getPlatform, isArchitectureSupported, isPlatformSupported} from "./features/search/systemArch";
import {
    buildDefaultM2SettingsPath,
    buildJdkVersionPath,
    buildMavenBinPath, buildMavenInstallationPath, buildMavenWrapperPath, buildVsCodeSettingPath, directoryHasContent,
    initializeBaseDirectories, initializeJdkEnvironment
} from "./features/build/directory";
import {ProjectContext, ProjectContextBuilder} from "./core/contextCore";
import {getJdkDistribution} from "./features/build/javaUrl";
import {downloadFile, DownloadResult} from "./util/fileDownload";
import {getMavenDistribution} from "./features/build/mavenUrl";
import {VersionPath} from "./core/versionCore";
import {extractTarGz} from "./features/unpacker/tarGz";
import {extractZip} from "./features/unpacker/zip";
import {updateVsCodeSettings} from "./features/build/settingTag";

export async function activate(context: vscode.ExtensionContext) {
    const showInfoNotification = vscode.commands.registerCommand('notifications-sample.showInfo', async () => {
        const choice = await vscode.window.showInformationMessage(
            Messages.Info.START_CONFIG,
            Messages.Choice.YES,
            Messages.Choice.NO
        );

        if (choice === Messages.Choice.YES) {
            // ========== STEP 1: INITIAL VALIDATIONS ==========
            const workspaceFolders = vscode.workspace.workspaceFolders;

            if (!workspaceFolders || workspaceFolders.length === 0) {
                return vscode.window.showWarningMessage(Messages.Warning.NOT_FOUND_WORKSPACE);
            }

            const arch = getArchitecture();

            if (!isArchitectureSupported(arch)) {
                return vscode.window.showWarningMessage(Messages.Warning.ARCHITECTURE_NOT_SUPPORTED);
            }

            const platform = getPlatform();

            if (!isPlatformSupported(platform)){
                return vscode.window.showWarningMessage(Messages.Warning.PLATAFORM_NOT_SUPPORTED);
            }

            const mavenDistribution = await getMavenDistribution(platform);

            if (mavenDistribution === null) {
                return vscode.window.showWarningMessage(Messages.Warning.MAVEN_DISTRIBUTION_NOT_FOUND);
            }

            const workspaceFolder = workspaceFolders[0].uri.fsPath;
            const allProjects = findProjectsWithPom(workspaceFolder);

            if (allProjects.length === 0) {
                return vscode.window.showWarningMessage(Messages.Warning.NOT_FOUND_POM);
            }

            const projectVersionMap = new Map<string, string[]>();

            for (const project of allProjects) {
                const javaVersion = parseJavaVersionFromPom(project);
                if (!javaVersion) {
                    continue;
                }

                const projects = projectVersionMap.get(javaVersion) ?? [];
                projects.push(project);
                projectVersionMap.set(javaVersion, projects);
            }

            if (projectVersionMap.size === 0) {
                return vscode.window.showWarningMessage(Messages.Warning.NOT_FOUND_JAVA_VERSION);
            }

            // ========== STEP 2: INITIALIZE DIRECTORIES ==========
            initializeBaseDirectories();

            // ========== STEP 3: BUILD VERSION PATHS ==========
            const versionPathsMap = new Map<string, VersionPath>();

            for (const javaVersion of projectVersionMap.keys()) {
                versionPathsMap.set(javaVersion, {
                    jdkHome: buildJdkVersionPath(javaVersion),
                    toolHome: buildMavenInstallationPath(javaVersion),
                    toolBin: buildMavenBinPath(javaVersion),
                });
            }

            // ========== STEP 4: START DOWNLOADS WITHOUT DUPLICATES ==========
            const jdkDownloadCache = new Map<string, Promise<DownloadResult>>();
            const mavenDownloadCache = new Map<string, Promise<DownloadResult>>();

            for (const [javaVersion, paths] of versionPathsMap) {
                const hasJdkHome = directoryHasContent(paths.jdkHome);

                // Check if the JDK needs to be downloaded.
                if (!hasJdkHome) {
                    const jdkDistribution = await getJdkDistribution(javaVersion, platform, arch);

                    if (jdkDistribution === null) {
                        return vscode.window.showWarningMessage(Messages.Warning.JDK_DISTRIBUTION_NOT_FOUND);
                    }

                    const jdkDownloadPromise = downloadFile({
                        url: jdkDistribution.url,
                        fileName: jdkDistribution.name,
                        extension: jdkDistribution.extension,
                    });

                    jdkDownloadCache.set(javaVersion, jdkDownloadPromise);
                }

                // Check if Maven needs to be downloaded for this JDK version.
                const hasToolHome = directoryHasContent(paths.toolHome);

                if (!hasToolHome) {
                    const mavenDownloadPromise = downloadFile({
                        url: mavenDistribution.url,
                        fileName: mavenDistribution.name,
                        extension: mavenDistribution.extension,
                    });

                    mavenDownloadCache.set(javaVersion, mavenDownloadPromise);
                }
            }

            // ========== STEP 6: BUILD CONTEXTS ==========
            const projectContexts: ProjectContext[] = [];

            for (const [javaVersion, projects] of projectVersionMap) {
                const paths = versionPathsMap.get(javaVersion)!;

                for (const project of projects) {
                    const builder = new ProjectContextBuilder(workspaceFolder, project)
                        .withSystemInfo(platform, arch)
                        .withJavaVersion(javaVersion)
                        .withJdkHome(paths.jdkHome)
                        .withToolPaths(paths.toolHome, paths.toolBin);

                    projectContexts.push(builder.build());
                }
            }

            for (const javaVersion of projectVersionMap.keys()) {
                initializeJdkEnvironment(javaVersion);
            }

            // ========== STEP 7: WAIT FOR DOWNLOADS AND START CONFIGURATION ==========
            const allDownloads: Promise<DownloadResult>[] = [
                ...jdkDownloadCache.values(),
                ...mavenDownloadCache.values(),
            ];

            if (allDownloads.length > 0) {
                const results = await Promise.all(allDownloads);

                const failedDownloads = results.filter(r => !r.success);
                if (failedDownloads.length > 0) {
                    return vscode.window.showErrorMessage(`Download failed: ${failedDownloads[0].error}`);
                }

                for (const [javaVersion, paths] of versionPathsMap) {
                    const jdkDownloadPromise = jdkDownloadCache.get(javaVersion);
                    const mavenDownloadPromise = mavenDownloadCache.get(javaVersion);

                    // Extract JDK if it was downloaded.
                    if (jdkDownloadPromise) {
                        const jdkResult = await jdkDownloadPromise;
                        if (jdkResult.success) {
                            if (jdkResult.filePath.endsWith('.tar.gz')) {
                                await extractTarGz(jdkResult.filePath, paths.jdkHome);
                            } else if (jdkResult.filePath.endsWith('.zip')) {
                                await extractZip(jdkResult.filePath, paths.jdkHome);
                            }
                        }
                    }

                    // Extract Maven if it was downloaded.
                    if (mavenDownloadPromise) {
                        const mavenResult = await mavenDownloadPromise;
                        if (mavenResult.success) {
                            if (mavenResult.filePath.endsWith('.tar.gz')) {
                                await extractTarGz(mavenResult.filePath, paths.toolHome);
                            } else if (mavenResult.filePath.endsWith('.zip')) {
                                await extractZip(mavenResult.filePath, paths.toolHome);
                            }
                        }
                    }
                }
            }

            // ========== STEP 8: CONFIGURE VS CODE SETTINGS ==========
            for (const projectContext of projectContexts) {
                const settingsPath = buildVsCodeSettingPath(projectContext.projectPath);

                // Build the paths needed for configuration.
                const javaMavenPaths = {
                    javaHomePath: projectContext.jdkHome,
                    mavenBinPath: buildMavenWrapperPath(projectContext.toolBin, projectContext.platform),
                    userSettingsPath: buildDefaultM2SettingsPath()
                };

                const updateResult = updateVsCodeSettings(settingsPath, javaMavenPaths);

                if (updateResult.updated) {
                    console.log(`Project ${projectContext.projectPath}: Settings updated - ${updateResult.addedKeys.join(', ')}`);
                }
            }

            vscode.window.showInformationMessage('Java/Maven environment configuration completed successfully!');
        }
    });

    context.subscriptions.push(showInfoNotification);
}
