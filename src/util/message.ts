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
 * - `Choice` — button labels for Yes/Always/No prompts.
 */
export const Messages = {
  Info: {
    START_CONFIG: 'This project looks like a Java project. Do you want to start automatic configuration?',
    CONFIGURATION_COMPLETED: 'Java and Maven environment configuration completed successfully!',
    AUTO_CONFIG_PREFERENCE_RESET:
      'Jaenvtix auto-configuration preference reset. Reload the window (or open another workspace) to see the prompt again.',
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
  },
  Progress: {
    TITLE: 'Java and Maven configuration',
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
      ConfigureLaunch: 'Configure Visual Studio Code launch configuration',
      RefreshProjectConfiguration: 'Refresh Java Language Server project configuration',
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
    TOOLCHAINS_XML_WRITTEN: (path: string) =>
      `~/.m2/toolchains.xml updated at ${path}`,
    RUNTIME_PATH_FIXED: (oldPath: string, newPath: string) =>
      `Fixed runtime path: ${oldPath} → ${newPath}`,
    RUNTIME_REMOVED: (name: string, path: string) =>
      `Removed invalid runtime: ${name} (${path})`,
  },
  Choice: {
    YES: 'Yes',
    ALWAYS: 'Always',
    NO: 'No',
  },
} as const;
