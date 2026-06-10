import {Messages} from '../util/message';

/**
 * One entry of the curated catalog the "Install Recommended Extensions"
 * command offers. `reason` is shown as the QuickPick detail line so the
 * user understands why Jaenvtix recommends it.
 */
export interface RecommendedExtension {
    id: string;
    name: string;
    description: string;
    reason: string;
}

/**
 * Canonical list of extensions a Java/Maven workspace needs to be productive.
 * Jaenvtix provisions settings these extensions consume — it never bundles or
 * force-installs them; this catalog only feeds the opt-in command.
 */
export const RECOMMENDED_EXTENSIONS: readonly RecommendedExtension[] = [
    {
        id: 'vscjava.vscode-java-pack',
        name: 'Extension Pack for Java',
        description: 'Official Microsoft/Red Hat pack with the Java language server, Maven, debugger, and test runner',
        reason: 'Essential — Jaenvtix provisions the settings these extensions consume',
    },
    {
        id: 'vmware.vscode-boot-dev-pack',
        name: 'Spring Boot Extension Pack',
        description: 'VMware pack for Spring Boot projects',
        reason: 'Spring Boot is dominant in modern Maven projects',
    },
    {
        id: 'redhat.vscode-xml',
        name: 'XML',
        description: 'Editing support for pom.xml, toolchains.xml, and settings.xml',
        reason: 'Schema validation and autocomplete for Maven XML files',
    },
];

/**
 * QuickPick item enriched with the data the install command needs after the
 * user confirms the selection. Structurally compatible with
 * `vscode.QuickPickItem` without importing `vscode`.
 */
export interface RecommendedExtensionPickItem {
    label: string;
    description: string;
    detail: string;
    picked: boolean;
    extensionId: string;
    isInstalled: boolean;
}

/**
 * Builds the QuickPick items for the recommended-extensions command.
 *
 * Business rules:
 * - Already-installed extensions are flagged "(already installed)" and NOT
 *   pre-picked, so confirming the default selection never reinstalls.
 * - Missing extensions are pre-picked — the common case (fresh install)
 *   becomes a single confirmation.
 */
export function buildRecommendedExtensionPickItems(
    isExtensionInstalled: (extensionId: string) => boolean,
): RecommendedExtensionPickItem[] {
    return RECOMMENDED_EXTENSIONS.map((extension) => {
        const isInstalled = isExtensionInstalled(extension.id);
        return {
            label: extension.name,
            description: isInstalled ? Messages.Picker.ALREADY_INSTALLED : extension.id,
            detail: extension.reason,
            picked: !isInstalled,
            extensionId: extension.id,
            isInstalled,
        };
    });
}
