import type {VersionPath} from '../core/types';
import {parseJavaVersionNumber, TOOLING_JAVA_MIN_VERSION} from '../util/javaVersion';

/**
 * Marketplace IDs of the Spring Boot Tools distributions. Either the
 * standalone language server extension or the dev pack that bundles it
 * qualifies — both register the `spring-boot.ls.java.home` setting.
 */
const SPRING_BOOT_EXTENSION_IDS = [
    'vmware.vscode-spring-boot',
    'vmware.vscode-boot-dev-pack',
] as const;

/**
 * A single user-settings write requested on behalf of a companion extension
 * detected in the user's VS Code installation.
 */
export interface OptionalExtensionUpdate {
    settingKey: string;
    value: string;
    extensionId: string;
}

/**
 * Picks the JDK home that should run companion language servers
 * (e.g. Spring Boot LS), which require Java 21+ like jdt.ls.
 *
 * Business rules:
 * - Only versions provisioned by the pipeline qualify: `versionPaths` already
 *   prefers a detected system JDK and falls back to the Jaenvtix cache slot.
 * - The highest qualifying major version wins, so a monorepo with Java 17 + 21
 *   projects points the LS at the 21 JDK.
 * - Returns `undefined` when no provisioned version satisfies the minimum —
 *   the LS cannot run on an older JDK, so writing a path would break it.
 */
export function selectLanguageServerJdkHome(
    versionPaths: ReadonlyMap<string, VersionPath>,
): string | undefined {
    let bestMajor = 0;
    let bestHome: string | undefined;

    for (const [version, paths] of versionPaths) {
        const major = parseJavaVersionNumber(version);
        if (major >= TOOLING_JAVA_MIN_VERSION && major > bestMajor) {
            bestMajor = major;
            bestHome = paths.jdkHome;
        }
    }

    return bestHome;
}

/**
 * Builds the user-settings updates for companion extensions present in the
 * user's installation.
 *
 * Business rules:
 * - No Java 21+ JDK available → no updates (Spring Boot LS requires 21+).
 * - Only one `spring-boot.ls.java.home` entry is produced even when both
 *   Spring Boot distributions are installed.
 * - Extension presence is injected so this module never imports `vscode`
 *   and stays loadable under plain Node in unit tests.
 */
export function detectOptionalExtensionConfig(
    languageServerJdkHome: string | undefined,
    isExtensionInstalled: (extensionId: string) => boolean,
): OptionalExtensionUpdate[] {
    if (!languageServerJdkHome) {
        return [];
    }

    for (const extensionId of SPRING_BOOT_EXTENSION_IDS) {
        if (isExtensionInstalled(extensionId)) {
            return [{
                settingKey: 'spring-boot.ls.java.home',
                value: languageServerJdkHome,
                extensionId,
            }];
        }
    }

    return [];
}
