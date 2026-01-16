import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {existsSync, readdirSync} from "node:fs";

const USER_HOME_PATH = homedir();
const MAVEN_LOCAL_REPOSITORY_PATH = join(USER_HOME_PATH, '.m2');

const JAENVTIX_ROOT_PATH = join(USER_HOME_PATH, '.jaenvtix');
export const JAENVTIX_TEMP_PATH = join(JAENVTIX_ROOT_PATH, 'temp');

export function buildDefaultM2SettingsPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'settings.xml');
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

export function buildVsCodePath(projectPath: string): string {
    return join(projectPath, '.vscode');
}

export function buildVsCodeSettingPath(projectPath: string): string {
    return join(buildVsCodePath(projectPath), 'settings.json');
}

export function directoryHasContent(path: string): boolean {
    if (existsSync(path)) {
        const contents = readdirSync(path);
        return contents.length > 0;
    }

    return false;
}

export function initializeBaseDirectories(): void {
    mkdirSync(MAVEN_LOCAL_REPOSITORY_PATH, { recursive: true });
    mkdirSync(JAENVTIX_ROOT_PATH, { recursive: true });
    mkdirSync(JAENVTIX_TEMP_PATH, { recursive: true });
}

export function initializeJdkEnvironment(javaVersion: string): void {
    mkdirSync(buildJdkVersionPath(javaVersion), { recursive: true });
    mkdirSync(buildMavenInstallationPath(javaVersion), { recursive: true });
}
