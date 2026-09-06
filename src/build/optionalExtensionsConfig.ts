import type {VersionPath} from '../core/types';
import {parseJavaVersionNumber} from '../util/javaVersion';
import {isLtsVersion} from './redhatRuntimeReader';

/**
 * Marketplace IDs of the Spring Boot Tools distributions, most specific first.
 * The setting belongs to the standalone language server extension; the dev
 * pack qualifies only as evidence that it should be there, since installing
 * the pack installs its members. A user who uninstalled the member while
 * keeping the pack leaves the setting unregistered, which is why the caller
 * writes through `writeCooperatively`.
 */
const SPRING_BOOT_EXTENSION_IDS = [
    'vmware.vscode-spring-boot',
    'vmware.vscode-boot-dev-pack',
] as const;

/** Marketplace ID of the Spring Initializr extension. */
const SPRING_INITIALIZR_EXTENSION_ID = 'vscjava.vscode-spring-initializr';

/**
 * Minimum Java version able to run the Spring Boot Language Server.
 *
 * Deliberately a separate constant from `TOOLING_JAVA_MIN_VERSION` (jdt.ls):
 * the two language servers evolve their JDK floors independently; Spring
 * Tools already ships Java-25-only features (CDS) while jdt.ls sits at 21.
 * A dynamic reader (like `redhatRuntimeReader`) was considered and declined:
 * the vmware.vscode-spring-boot manifest exposes no machine-readable JDK
 * requirement to read. The upstream-schema CI watch flags manifest changes,
 * so this constant is revisited when upstream publishes one.
 */
const SPRING_BOOT_LS_MIN_JAVA_VERSION = 21;

/**
 * Lowest Java version worth offering as the Spring Initializr default:
 * Spring Boot 3+ requires Java 17, and start.spring.io no longer offers
 * older versions. Seeding below this would produce a value the service
 * rejects.
 */
const INITIALIZR_MIN_JAVA_VERSION = 17;

/**
 * A single user-settings write requested on behalf of a companion extension
 * detected in the user's VS Code installation.
 */
export interface OptionalExtensionUpdate {
    settingKey: string;
    value: string;
    extensionId: string;
}

/** Values derived from the pipeline state that feed companion-extension writes. */
export interface OptionalExtensionInputs {
    /** JDK home able to run companion language servers, or `undefined` when none. */
    languageServerJdkHome: string | undefined;
    /** Java version to offer as the Spring Initializr default, or `undefined` when none. */
    initializrDefaultJavaVersion: string | undefined;
}

/**
 * Picks the JDK home that should run the Spring Boot Language Server.
 *
 * Business rules:
 * - Only versions provisioned by the pipeline qualify: `versionPaths` already
 *   prefers a detected system JDK and falls back to the Jaenvtix cache slot.
 * - The highest qualifying major version wins, so a monorepo with Java 17 + 21
 *   projects points the LS at the 21 JDK.
 * - Returns `undefined` when no provisioned version satisfies
 *   `SPRING_BOOT_LS_MIN_JAVA_VERSION`; the LS cannot run on an older JDK,
 *   so writing a path would break it.
 */
export function selectLanguageServerJdkHome(
    versionPaths: ReadonlyMap<string, VersionPath>,
): string | undefined {
    let bestMajor = 0;
    let bestHome: string | undefined;

    for (const [version, paths] of versionPaths) {
        const major = parseJavaVersionNumber(version);
        if (major >= SPRING_BOOT_LS_MIN_JAVA_VERSION && major > bestMajor) {
            bestMajor = major;
            bestHome = paths.jdkHome;
        }
    }

    return bestHome;
}

/**
 * Picks the Java version to seed as `spring.initializr.defaultJavaVersion`.
 *
 * Business rules:
 * - Only LTS releases qualify; start.spring.io only offers LTS versions, so
 *   a non-LTS default would be silently useless.
 * - The version must be >= 17 (Spring Boot 3 floor, see
 *   `INITIALIZR_MIN_JAVA_VERSION`).
 * - The highest qualifying provisioned version wins: new Initializr projects
 *   should start on the most modern JDK the workspace already has.
 * - Returns `undefined` when nothing qualifies (nothing is written).
 */
export function selectInitializrDefaultJavaVersion(
    versionPaths: ReadonlyMap<string, VersionPath>,
): string | undefined {
    let bestMajor = 0;

    for (const version of versionPaths.keys()) {
        const major = parseJavaVersionNumber(version);
        if (major >= INITIALIZR_MIN_JAVA_VERSION && isLtsVersion(major) && major > bestMajor) {
            bestMajor = major;
        }
    }

    return bestMajor > 0 ? String(bestMajor) : undefined;
}

/**
 * Builds the user-settings updates for companion extensions present in the
 * user's installation.
 *
 * Business rules:
 * - Spring Boot Tools: no Java 21+ JDK available → no update (the LS requires
 *   21+). Only one `spring-boot.ls.java.home` entry is produced even when
 *   both Spring Boot distributions are installed.
 * - Spring Initializr: seeds `spring.initializr.defaultJavaVersion` with the
 *   qualifying version from `selectInitializrDefaultJavaVersion`.
 * - Extension presence is injected so this module never imports `vscode`
 *   and stays loadable under plain Node in unit tests.
 * - The caller (`ConfigureOptionalExtensionsStep`) is responsible for the
 *   "never overwrite a value the user set" guard via `inspect()`.
 */
export function detectOptionalExtensionConfig(
    inputs: OptionalExtensionInputs,
    isExtensionInstalled: (extensionId: string) => boolean,
): OptionalExtensionUpdate[] {
    const updates: OptionalExtensionUpdate[] = [];

    if (inputs.languageServerJdkHome) {
        for (const extensionId of SPRING_BOOT_EXTENSION_IDS) {
            if (isExtensionInstalled(extensionId)) {
                updates.push({
                    settingKey: 'spring-boot.ls.java.home',
                    value: inputs.languageServerJdkHome,
                    extensionId,
                });
                break;
            }
        }
    }

    if (inputs.initializrDefaultJavaVersion && isExtensionInstalled(SPRING_INITIALIZR_EXTENSION_ID)) {
        updates.push({
            settingKey: 'spring.initializr.defaultJavaVersion',
            value: inputs.initializrDefaultJavaVersion,
            extensionId: SPRING_INITIALIZR_EXTENSION_ID,
        });
    }

    return updates;
}
