import {existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {PlatformType} from '../core/system';

const USER_HOME_PATH = homedir();
const MAVEN_LOCAL_REPOSITORY_PATH = join(USER_HOME_PATH, '.m2');

const JAENVTIX_ROOT_PATH = join(USER_HOME_PATH, '.jaenvtix');
export const JAENVTIX_TEMP_PATH = join(JAENVTIX_ROOT_PATH, 'temp');

export function buildDefaultM2SettingsPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'settings.xml');
}

export function buildDefaultM2RepositoryPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'repository');
}

export function buildJdkVersionPath(javaVersion: string): string {
    return join(JAENVTIX_ROOT_PATH, `jdk-${javaVersion}`);
}

export function buildMavenInstallationPath(javaVersion: string): string {
    return join(buildJdkVersionPath(javaVersion), 'mvn-custom');
}

export function buildMavenBinPath(javaVersion: string): string {
    return join(buildMavenInstallationPath(javaVersion), 'bin');
}

export function buildMavenWrapperPath(basePath: string, platform: PlatformType): string {
    if (platform === 'windows') {
        return join(basePath, 'mvn.cmd');
    }

    return join(basePath, 'mvn');
}

export function buildJaenvtixMavenScriptPath(basePath: string, platform: PlatformType): string {
    if (platform === 'windows') {
        return join(basePath, 'jaenvtix-mvn.cmd');
    }

    return join(basePath, 'jaenvtix-mvn');
}

export function buildVsCodePath(projectPath: string): string {
    return join(projectPath, '.vscode');
}

export function buildVsCodeSettingPath(projectPath: string): string {
    return join(buildVsCodePath(projectPath), 'settings.json');
}

export function buildVsCodeLaunchPath(projectPath: string): string {
    return join(buildVsCodePath(projectPath), 'launch.json');
}

export function hasJdkInstallation(jdkHome: string, platform: PlatformType): boolean {
    const javaBin = platform === 'windows' ? 'java.exe' : 'java';
    return existsSync(join(jdkHome, 'bin', javaBin));
}

export function hasMavenInstallation(toolBin: string, platform: PlatformType): boolean {
    const mvnBin = platform === 'windows' ? 'mvn.cmd' : 'mvn';
    return existsSync(join(toolBin, mvnBin));
}

export function initializeBaseDirectories(): void {
    mkdirSync(MAVEN_LOCAL_REPOSITORY_PATH, { recursive: true });
    mkdirSync(JAENVTIX_ROOT_PATH, { recursive: true });
    mkdirSync(JAENVTIX_TEMP_PATH, { recursive: true });
}
