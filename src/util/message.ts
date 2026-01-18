const UNKNOWN_ERROR_DETAIL = 'Unknown error';

export const Messages = {
  Info: {
    START_CONFIG: 'This project looks like a Java project. Do you want to start automatic configuration?',
    CONFIGURATION_COMPLETED: 'Java and Maven environment configuration completed successfully!',
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
  },
  Error: {
    STEP_FAILED: (stepLabel: string, detail: string) => `${stepLabel} failed: ${detail}`,
    WORKSPACE_FOLDER_NOT_RESOLVED: 'Workspace folder not resolved.',
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
      PrepareVersionPaths: 'Build version paths',
      ScheduleDownloads: 'Schedule downloads',
      BuildProjectContexts: 'Build project contexts',
      ProcessDownloads: 'Download and extract tools',
      ConfigureSettings: 'Configure Visual Studio Code settings',
    } as Record<string, string>,
  },
  Log: {
    SETTINGS_UPDATED: (projectPath: string, keys: string[]) =>
      `Project ${projectPath}: Settings updated - ${keys.join(', ')}`,
  },
  Choice: {
    YES: 'Yes',
    NO: 'No',
  },
} as const;
