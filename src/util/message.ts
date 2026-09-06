const UNKNOWN_ERROR_DETAIL = 'Unknown error';

/**
 * Centralized UI and log strings for Jaenvtix. Keeping all user-facing text
 * here prevents duplicated literals and makes it easy to review wording.
 *
 * Structure:
 * - `Info` — informational messages shown in VS Code notification toasts.
 * - `Warning` — non-fatal issues surfaced as warning notifications.
 * - `Error` — error messages for failed operations.
 * - `Progress` — labels displayed in the progress notification during the
 *   configuration pipeline (one label per step).
 * - `Log` — structured messages written to the output channel.
 * - `Choice` — button labels for notification prompts.
 */
export const Messages = {
    Info: {
        START_CONFIG: 'This project looks like a Java project. Do you want to start automatic configuration?',
        START_CONFIG_WITH_EXTENSIONS:
            'This project looks like a Java project, but Java language support is not installed. Jaenvtix can install the Extension Pack for Java and configure the workspace.',
        CONFIGURATION_COMPLETED: 'Java and Maven environment configuration completed successfully!',
        AUTO_CONFIG_PREFERENCE_RESET:
      'Jaenvtix auto-configuration preference reset for every workspace. Reload the window (or open another workspace) to see the prompt again.',
        ALL_SELECTED_EXTENSIONS_INSTALLED: 'All selected extensions are already installed.',
        EXTENSIONS_INSTALLED: (count: number) =>
            `${count} extension${count === 1 ? '' : 's'} installed. Reload the window to activate ${count === 1 ? 'it' : 'them'}.`,
        LS_JDK_CHANGED_RESTART:
            'Jaenvtix updated the JDK used by the Java Language Server (Red Hat). Restart the Language Server to apply it — no window reload needed.',
        PROJECT_VERIFICATION_MISMATCH: (folder: string, actualCompliance: string, expectedMajor: number) =>
            `Jaenvtix: "${folder}" is still compiling at Java ${actualCompliance}, but its pom requests Java ${expectedMajor}. The Java Language Server (Red Hat) applies the new JDK after a restart.`,
        PROJECT_VERIFICATION_MISMATCH_MANY: (count: number) =>
            `Jaenvtix: ${count} projects are still compiling at a different Java level than their poms request. The Java Language Server (Red Hat) applies the new JDK after a restart. See the "Jaenvtix" output channel for details.`,
        REOPEN_TERMINALS:
            'Jaenvtix updated the terminal environment (JAVA_HOME/PATH). Close and reopen existing terminals to pick up the new values.',
    },
    Warning: {
        NOT_FOUND_WORKSPACE: 'No workspaces open. Nothing to do.',
        ARCHITECTURE_NOT_SUPPORTED: 'Unsupported architecture. Supported architectures: x64 and ARM64 (aarch64).',
        PLATFORM_NOT_SUPPORTED: 'Unsupported platform. Supported platforms: Windows, Linux, and macOS.',
        NOT_FOUND_POM: 'No pom.xml file found in the workspace. Nothing to do.',
        NOT_FOUND_JAVA_VERSION: 'No Java version found in pom.xml. Nothing to do.',
        MAVEN_DISTRIBUTION_NOT_FOUND: 'Unable to resolve a Maven distribution for this platform.',
        JDK_DISTRIBUTION_NOT_FOUND: 'Unable to resolve a Java Development Kit distribution for this platform and version.',
        CONFIGURATION_CANCELLED: 'Configuration canceled by the user.',
        CONFIG_SKIPPED_NO_LANGUAGE_SUPPORT:
            'Jaenvtix did not configure this workspace: Java language support is still not active. Reload the window, or install and enable the Extension Pack for Java, then open the project again.',
        TEMP_CLEANUP_FAILED: (filePath: string, detail: string) =>
            `Failed to remove temporary archive ${filePath}: ${detail}`,
        LAUNCH_JSON_MALFORMED: (filePath: string) =>
            `Existing launch.json at ${filePath} could not be parsed and was reset. Previous launch configurations were dropped.`,
    },
    Error: {
        STEP_FAILED: (stepLabel: string, detail: string) => `${stepLabel} failed: ${detail}`,
        WORKSPACE_FOLDER_NOT_RESOLVED: 'Workspace folders not resolved.',
        MISSING_PLATFORM_ARCH_MAVEN: 'Missing platform, architecture, or Maven distribution information.',
        MISSING_WORKSPACE_PLATFORM_ARCH: 'Missing workspace, platform, or architecture information.',
        MISSING_PLATFORM: 'Missing platform information.',
        DOWNLOAD_FAILED: (detail?: string) => `Download failed: ${detail ?? UNKNOWN_ERROR_DETAIL}`,
        JDK_NOT_AVAILABLE: (version: string) => `Java Development Kit not available for Java ${version}.`,
        JDK_EXTRACTION_FAILED: (version: string) => `Java Development Kit extraction failed for Java ${version}.`,
        MAVEN_EXTRACTION_FAILED: (version: string) => `Maven extraction failed for Java ${version}.`,
        INVALID_URL: 'Invalid download URL.',
        REDIRECT_WITHOUT_LOCATION: 'Redirect response missing a location header.',
        TOO_MANY_REDIRECTS: 'Too many redirects while downloading.',
        INVALID_REDIRECT_URL: 'Invalid redirect URL.',
        REQUEST_FAILED_STATUS: (statusCode: number) => `Request failed with status code ${statusCode}.`,
        REQUEST_TIMEOUT: 'Request timed out.',
        SETTINGS_PARSE_FAILED: 'Failed to parse the settings file. A new settings file will be created.',
        LAUNCH_PARSE_FAILED: 'Failed to parse the launch file. A new launch file will be created.',
        MAVEN_PAGE_FETCH_FAILED: (url: string) => `Failed to fetch the Maven download page: ${url}.`,
        UNSUPPORTED_ZIP_COMPRESSION: (method: number) => `Unsupported compression method: ${method}.`,
        EXTENSION_INSTALL_FAILED: (name: string, detail: string) => `Failed to install ${name}: ${detail}`,
    },
    Picker: {
        RECOMMENDED_TITLE: 'Jaenvtix — Recommended Java Extensions',
        RECOMMENDED_PLACEHOLDER: 'Select extensions to install (already installed ones are ignored)',
        ALREADY_INSTALLED: '(already installed)',
    },
    Progress: {
        TITLE: 'Java and Maven configuration',
        INSTALL_EXTENSIONS_TITLE: 'Jaenvtix: Installing recommended extensions',
        INSTALL_LANGUAGE_SUPPORT_TITLE: 'Jaenvtix: Installing Extension Pack for Java',
        DEFAULT: 'Running configuration step',
        STEPS: {
            ValidateEnvironment: 'Validate environment',
            ResolveProjects: 'Resolve projects',
            ConfirmConfiguration: 'Confirm configuration',
            InitializeDirectories: 'Initialize directories',
            DetectInstalledJdks: 'Detect installed JDKs',
            PrepareVersionPaths: 'Build version paths',
            ScheduleDownloads: 'Schedule downloads',
            BuildProjectContexts: 'Build project contexts',
            ProcessDownloads: 'Download and extract tools',
            WriteMavenWrappers: 'Write Jaenvtix Maven wrapper scripts',
            WriteToolchains: 'Write ~/.m2/toolchains.xml',
            ConfigureSettings: 'Configure Visual Studio Code settings',
            ConfigureUserRuntimes: 'Register JDKs in Visual Studio Code user settings',
            ApplyUserTunings: 'Apply sensible Java defaults to user settings',
            ConfigureOptionalExtensions: 'Configure companion extensions',
            ConfigureLaunch: 'Configure Visual Studio Code launch configuration',
            RecommendExtensions: 'Write workspace extension recommendations',
            AwaitLanguageServer: 'Waiting for the Java Language Server to finish loading…',
            RefreshProjectConfiguration: 'Refresh Java Language Server project configuration',
            VerifyConfiguration: 'Verify resolved project configuration',
        } as Record<string, string>,
    },
    Log: {
        SETTINGS_UPDATED: (projectPath: string, keys: string[]) =>
            `Project ${projectPath}: Settings updated - ${keys.join(', ')}`,
        LAUNCH_UPDATED: (projectPath: string, names: string[]) =>
            `Project ${projectPath}: Launch configuration updated - ${names.join(', ')}`,
        LAUNCH_SKIPPED: (projectPath: string) =>
            `Project ${projectPath}: Launch configuration skipped (main class not found).`,
        MAVEN_WRAPPER_WRITTEN: (javaVersion: string, scriptPath: string) =>
            `Java ${javaVersion}: Jaenvtix Maven wrapper written at ${scriptPath}`,
        USER_RUNTIMES_UPDATED: (count: number) =>
            `User-level java.configuration.runtimes updated (${count} entr${count === 1 ? 'y' : 'ies'}).`,
        USER_RUNTIMES_SKIPPED: (detail: string) =>
            `java.configuration.runtimes not updated: ${detail}. The Red Hat Java extension (redhat.java) registers this setting and is likely not installed.`,
        TOOLCHAINS_XML_WRITTEN: (path: string) =>
            `~/.m2/toolchains.xml updated at ${path}`,
        RUNTIME_PATH_FIXED: (oldPath: string, newPath: string) =>
            `Fixed runtime path: ${oldPath} → ${newPath}`,
        RUNTIME_REMOVED: (name: string, path: string) =>
            `Removed invalid runtime: ${name} (${path})`,
        OPTIONAL_EXTENSION_CONFIGURED: (settingKey: string, extensionId: string, value: string) =>
            `Configured ${settingKey} for ${extensionId}: ${value}`,
        OPTIONAL_EXTENSION_SKIPPED: (settingKey: string, extensionId: string, detail: string) =>
            `${settingKey} not configured for ${extensionId}: ${detail}. The extension is installed but does not register this setting.`,
        LANGUAGE_SERVER_RESTART_FAILED: (detail: string) =>
            `Language Server restart command failed: ${detail}`,
        TUNING_SKIPPED: (settingKey: string, detail: string) =>
            `User tuning ${settingKey} not applied: ${detail}. The extension that registers this setting is likely not installed.`,
        TOOLCHAINS_JDK_DETECTED: (jdkHome: string, version?: string) =>
            `Detected JDK from toolchains.xml: ${jdkHome}${version ? ` (version ${version})` : ''}`,
        TOOLCHAINS_READ_FAILED: (detail: string) =>
            `Failed to read ~/.m2/toolchains.xml: ${detail}`,
        PACKAGE_MANAGER_JDK_DETECTED: (source: string, jdkHome: string) =>
            `Detected JDK from ${source}: ${jdkHome}`,
        JDK_PATCH_UPDATE: (javaVersion: string, current: string, latest: string) =>
            `Java ${javaVersion}: newer patch available (${current} → ${latest}); refreshing the cached JDK.`,
        DOWNLOAD_RETRY: (attempt: number, max: number, url: string, detail: string) =>
            `Retrying download (${attempt}/${max}) after transient failure (${detail}): ${url}`,
        REFRESH_SKIPPED_REDHAT_MISSING:
            'Language Server refresh skipped: Red Hat Java extension (redhat.java) is not installed.',
        REFRESH_SKIPPED_NO_CHANGES:
            'Language Server refresh skipped: no project settings changed in this run.',
        SERVER_READY_UNCONFIRMED:
            'Java Language Server readiness cannot be confirmed on this redhat.java version; refreshing projects best-effort.',
        SERVER_READY_TIMEOUT_DEFERRED: (timeoutMs: number) =>
            `Java Language Server still loading after ${Math.round(timeoutMs / 1000)}s; refresh and verification will resume automatically once it is ready.`,
        SERVER_READY_CONTINUATION_RESUMED:
            'Java Language Server is ready; running the deferred project refresh and verification.',
        VERIFY_SKIPPED_LIGHTWEIGHT:
            'Verification skipped: the Java Language Server runs in LightWeight mode (user choice), so no compiler compliance is resolved.',
        VERIFY_BACKLOG_RESUMED: (count: number) =>
            `Re-verifying ${count} project${count === 1 ? '' : 's'} flagged with a mismatch in the previous run.`,
        VERIFY_PROJECT_NO_SOURCES: (projectPath: string) =>
            `Project ${projectPath}: verification skipped (no src/main/java — aggregator or non-source project).`,
        VERIFY_PROJECT_OK: (projectPath: string, expectedMajor: number) =>
            `Project ${projectPath}: Language Server resolved Java ${expectedMajor} as expected.`,
        VERIFY_PROJECT_MISMATCH: (projectPath: string, expectedMajor: number, actualCompliance: string) =>
            `Project ${projectPath}: expected Java ${expectedMajor} but Language Server resolved compliance ${actualCompliance}.`,
        VERIFY_PROJECT_SKIPPED: (projectPath: string) =>
            `Project ${projectPath}: verification skipped (project settings unavailable).`,
        EXTENSIONS_JSON_UPDATED: (workspace: string, added: string[]) =>
            `Workspace ${workspace}: .vscode/extensions.json recommendations updated - ${added.join(', ')}`,
        EXTENSION_PACK_INSTALLING: (extensionId: string) =>
            `Installing ${extensionId} before configuring, at the user's request.`,
        EXTENSION_PACK_INSTALL_FAILED: (extensionId: string, detail: string) =>
            `Could not install ${extensionId}: ${detail}`,
        LANGUAGE_SERVER_READY: (extensionId: string) =>
            `${extensionId} is available; continuing with the configuration.`,
        LANGUAGE_SERVER_STILL_ABSENT: (extensionId: string) =>
            `${extensionId} is still unavailable, so nothing was configured. It may need a window reload, or it may be installed but disabled.`,
        EXTENSION_PAGE_NOT_OPENED: (extensionId: string) =>
            `Could not open the extension page for ${extensionId}.`,
        ACTIVATED: (folderCount: number) =>
            `Jaenvtix activated with ${folderCount} workspace folder${folderCount === 1 ? '' : 's'}.`,
        AUTO_CONFIG_SKIPPED_NO_FOLDERS:
            'Automatic configuration skipped: this window has no workspace folders.',
        AUTO_CONFIG_SKIPPED_DECLINED:
            'Automatic configuration skipped: this workspace was declined. Run "Jaenvtix: Java: Automatic Configuration" to configure it anyway, or "Jaenvtix: Reset Auto-Configuration Preference" to be asked again.',
        AUTO_CONFIG_SKIPPED_CONFIGURED:
            'Automatic configuration skipped: this workspace is already configured.',
        AUTO_CONFIG_PROMPT_FAILED: (detail: string) =>
            `The activation prompt failed: ${detail}. Jaenvtix is still available from the Command Palette.`,
    },
    Choice: {
        YES: 'Yes',
        NO: 'No',
        RELOAD_NOW: 'Reload Now',
        INSTALL_AND_CONFIGURE: 'Install and Configure',
        SHOW_EXTENSION: 'Show Extension',
        RESTART_LANGUAGE_SERVER: 'Restart Language Server',
        SHOW_LOGS: 'Show Logs',
    },
} as const;
