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

/**
 * Returns the path where Maven is installed for a given Java version.
 * Without `mavenVersion`: the shared Jaenvtix-latest slot
 * (`~/.jaenvtix/jdk-<v>/mvn-custom/`, back-compat with existing caches).
 * With `mavenVersion`: the isolated per-version slot
 * (`~/.jaenvtix/jdk-<v>/mvn-<mavenVersion>/`) used by projects that pin a
 * Maven version in their pom.
 */
export function buildMavenInstallationPath(javaVersion: string, mavenVersion?: string): string {
    const subdir = mavenVersion ? `mvn-${mavenVersion}` : 'mvn-custom';
    return join(buildJdkVersionPath(javaVersion), subdir);
}

/** Returns the `bin/` directory of the Maven installation for a given Java version. */
export function buildMavenBinPath(javaVersion: string, mavenVersion?: string): string {
    return join(buildMavenInstallationPath(javaVersion, mavenVersion), 'bin');
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
 * Resolves the directory that actually contains `bin/java` for the JDK
 * installed at `jdkHome`.
 *
 * Business rules:
 * - Plain layout (`<jdkHome>/bin/java[.exe]`) — Windows/Linux archives and
 *   paths that already point at a Java home — resolves to `jdkHome` itself.
 * - macOS bundle layout (`<jdkHome>/Contents/Home/bin/java`) — what a macOS
 *   JDK `.tar.gz` produces when extracted into the Jaenvtix cache slot —
 *   resolves to `<jdkHome>/Contents/Home`. Only probed on `darwin`; archives
 *   for other platforms never ship the bundle structure.
 * - Returns `undefined` when neither location contains the java binary,
 *   i.e. there is no usable JDK at `jdkHome`.
 */
export function resolveJdkInstallationHome(jdkHome: string, platform: PlatformType): string | undefined {
    const javaBin = platform === 'windows' ? 'java.exe' : 'java';

    if (existsSync(join(jdkHome, 'bin', javaBin))) {
        return jdkHome;
    }

    if (platform === 'darwin') {
        const bundleHome = join(jdkHome, 'Contents', 'Home');
        if (existsSync(join(bundleHome, 'bin', javaBin))) {
            return bundleHome;
        }
    }

    return undefined;
}

/**
 * Returns `true` if a JDK installation exists at `jdkHome` in any layout
 * recognized by `resolveJdkInstallationHome`.
 */
export function hasJdkInstallation(jdkHome: string, platform: PlatformType): boolean {
    return resolveJdkInstallationHome(jdkHome, platform) !== undefined;
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
