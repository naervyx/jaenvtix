export class Messages {
  public static readonly Info = class {
    public static readonly START_CONFIG =
        'This has been detected as a Java project. Do you want to start automatic configuration?';
  };

  public static readonly Error = class {
  };

  public static readonly Warning = class {
    public static readonly NOT_FOUND_WORKSPACE = 'No workspaces open. Nothing to do.';
    public static readonly ARCHITECTURE_NOT_SUPPORTED = 'ArchitectureType not supported. Only x64 and ARM64 (aarch64) are supported.';
    public static readonly PLATAFORM_NOT_SUPPORTED = 'PlatformType not supported. Only Windows, Linux and Mac are supported.';
    public static readonly NOT_FOUND_POM = 'No pom.xml found in workspace. Nothing to do.';
    public static readonly NOT_FOUND_JAVA_VERSION = 'Not found java version in pom.xml. Nothing to do.';
    public static readonly MAVEN_DISTRIBUTION_NOT_FOUND = 'Unable to resolve a Maven distribution for this platform.';
    public static readonly JDK_DISTRIBUTION_NOT_FOUND = 'Unable to resolve a JDK distribution for this platform/version.';
  };

  public static readonly Choice = class {
      public static readonly YES = 'Yes';
      public static readonly NO = 'No';
  };
}

/*vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Progress Notification",
    cancellable: true
}, (progress, token) => {
    token.onCancellationRequested(() => {
        console.log("User canceled the long running operation");
    });

    progress.report({ increment: 0 });

    setTimeout(() => {
        progress.report({ increment: 10, message: "Still going..." });
    }, 1000);

    setTimeout(() => {
        progress.report({ increment: 40, message: "Still going even more..." });
    }, 2000);

    setTimeout(() => {
        progress.report({ increment: 50, message: "I am long running! - almost there..." });
    }, 3000);

    return new Promise<void>(resolve => {
        setTimeout(() => {
            resolve();
        }, 50000);
    });
});*/
