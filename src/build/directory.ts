import {existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {PlatformType} from '../core/system';

const USER_HOME_PATH = homedir();
const MAVEN_LOCAL_REPOSITORY_PATH = join(USER_HOME_PATH, '.m2');

/** Root of the Jaenvtix cache directory (`~/.jaenvtix/`). Contains per-version JDK and Maven installations. */
const JAENVTIX_ROOT_PATH = join(USER_HOME_PATH, '.jaenvtix');

/** Temporary directory for in-progress archive downloads (`~/.jaenvtix/temp/`). Cleaned up after extraction. */
export const JAENVTIX_TEMP_PATH = join(JAENVTIX_ROOT_PATH, 'temp');

/** Returns the path to the user's global Maven settings file (`~/.m2/settings.xml`). */
export function buildDefaultM2SettingsPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'settings.xml');
}

/** Returns the path to the user's local Maven repository (`~/.m2/repository/`). */
export function buildDefaultM2RepositoryPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'repository');
}

/** Returns the path to the Maven toolchains file (`~/.m2/toolchains.xml`). */
export function buildDefaultM2ToolchainsPath(){
    return join(MAVEN_LOCAL_REPOSITORY_PATH, 'toolchains.xml');
}

/** Returns the Jaenvtix cache directory for a specific Java version (`~/.jaenvtix/jdk-<version>/`). */
export function buildJdkVersionPath(javaVersion: string): string {
    return join(JAENVTIX_ROOT_PATH, `jdk-${javaVersion}`);
}

/** Returns the path where Maven is installed for a given Java version (`~/.jaenvtix/jdk-<version>/mvn-custom/`). */
export function buildMavenInstallationPath(javaVersion: string): string {
    return join(buildJdkVersionPath(javaVersion), 'mvn-custom');
}

/** Returns the `bin/` directory of the Maven installation for a given Java version. */
export function buildMavenBinPath(javaVersion: string): string {
    return join(buildMavenInstallationPath(javaVersion), 'bin');
}

/**
 * Returns the platform-appropriate path to the Maven executable inside `basePath`.
 * Windows uses `mvn.cmd`; POSIX uses `mvn`.
 */
export function buildMavenWrapperPath(basePath: string, platform: PlatformType): string {
    if (platform === 'windows') {
        return join(basePath, 'mvn.cmd');
    }

    return join(basePath, 'mvn');
}

/**
 * Returns the platform-appropriate path to the Jaenvtix Maven wrapper script inside `basePath`.
 * Windows uses `jaenvtix-mvn.cmd`; POSIX uses `jaenvtix-mvn`.
 */
export function buildJaenvtixMavenScriptPath(basePath: string, platform: PlatformType): string {
    if (platform === 'windows') {
        return join(basePath, 'jaenvtix-mvn.cmd');
    }

    return join(basePath, 'jaenvtix-mvn');
}

/** Returns the `.vscode/` directory path for a project. */
export function buildVsCodePath(projectPath: string): string {
    return join(projectPath, '.vscode');
}

/** Returns the `.vscode/settings.json` path for a project. */
export function buildVsCodeSettingPath(projectPath: string): string {
    return join(buildVsCodePath(projectPath), 'settings.json');
}

/** Returns the `.vscode/launch.json` path for a project. */
export function buildVsCodeLaunchPath(projectPath: string): string {
    return join(buildVsCodePath(projectPath), 'launch.json');
}

/**
 * Returns `true` if a JDK installation exists at `jdkHome` by checking for
 * the `java` (or `java.exe` on Windows) binary in `<jdkHome>/bin/`.
 */
export function hasJdkInstallation(jdkHome: string, platform: PlatformType): boolean {
    const javaBin = platform === 'windows' ? 'java.exe' : 'java';
    return existsSync(join(jdkHome, 'bin', javaBin));
}

/**
 * Returns `true` if a Maven installation exists at `toolBin` by checking for
 * the `mvn` (or `mvn.cmd` on Windows) binary.
 */
export function hasMavenInstallation(toolBin: string, platform: PlatformType): boolean {
    const mvnBin = platform === 'windows' ? 'mvn.cmd' : 'mvn';
    return existsSync(join(toolBin, mvnBin));
}

/**
 * Creates the Jaenvtix root cache directory, temp directory, and `~/.m2/` if
 * any of them are missing. Called once at the start of the post-confirm phase
 * so subsequent steps can write files without checking for directory existence.
 */
export function initializeBaseDirectories(): void {
    mkdirSync(MAVEN_LOCAL_REPOSITORY_PATH, {recursive: true});
    mkdirSync(JAENVTIX_ROOT_PATH, {recursive: true});
    mkdirSync(JAENVTIX_TEMP_PATH, {recursive: true});
}
