# VS Code Workspace Configuration

Jaenvtix manages a curated subset of keys in `.vscode/settings.json` to align the workspace experience with the provisioned tools. The `updateWorkspaceSettings` function from the `vscodeConfig` module updates the following entries:

## Responsibilities

- Persist the provisioned JDK path into `java.jdt.ls.java.home` so the Java language server reuses Jaenvtix toolchains.
- Point `maven.executable.path` to the bundled `mvn-jaenvtix` wrapper and ensure the Maven extension reuses `JAVA_HOME`.
- Merge settings without clobbering user-defined keys or formatting.
- Provide idempotent writes—running provisioning repeatedly keeps the file byte-identical when nothing changes.

## Dependencies

- **VS Code workspace API** — obtains the target workspace folder and resolves `.vscode/settings.json` paths.
- **Filesystem adapter** — reads/writes JSON while preserving indentation and newline conventions.
- **`fsLayout` module** — supplies the resolved Maven wrapper path coupled to the active JDK.

## Standard Error Flows

- **File read failure**: throws `WorkspaceSettingsReadError` if existing JSON cannot be loaded; provisioning stops for that workspace.
- **JSON parse failure**: surfaces `WorkspaceSettingsParseError` including the problematic snippet and suggests manual repair.
- **Write failure**: raises `WorkspaceSettingsWriteError` with the destination path, signalling permission or disk space issues.

## Managed Keys

| Key | Controlled value | Purpose |
| --- | --- | --- |
| `java.jdt.ls.java.home` | Absolute path to the provisioned JDK. | Ensures the Java Language Server uses the extension-selected `JAVA_HOME`. |
| `maven.executable.path` | Path to the `mvn-jaenvtix` wrapper. | Points VS Code to the Maven binary bundled with the provisioned JDK. |
| `maven.terminal.useJavaHome` | Always `true`. | Instructs the Maven extension to reuse the configured `JAVA_HOME`, keeping builds and executions consistent. |

Only these keys are modified; any additional settings in `settings.json` remain untouched. Updates are idempotent: merging the same toolchain information multiple times keeps the file identical byte for byte.

## Known Limitations

Refer to [VS Code Workspace Configuration — Known Limitations](./limitations.md) for constraints and mitigation guidance.
