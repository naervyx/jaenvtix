# `pom.xml` Scanner

## Overview

The `scannerPom` module finds `pom.xml` files under a workspace root and extracts the target Java version declared by each Maven project. It is designed for the VS Code extension but avoids direct editor dependencies, which keeps unit testing straightforward.

## Responsibilities

- Traverse workspaces efficiently while respecting ignore lists for common build artefacts.
- Derive Java version requirements from Maven configuration, prioritising explicit compiler plugin settings.
- Produce deterministic, sorted results that the orchestrator can use to queue provisioning tasks.
- Provide helper utilities for inspecting individual POM files on demand.

## Dependencies

- **`@shared/fs` traversal helpers** — perform globbing and folder exclusion with cancellation support.
- **`@shared/xml` streaming parser** — reads large POM files without loading them entirely in memory.
- **Configuration bridge** — supplies ignore patterns and depth limits controlled by the extension settings.

## Standard Error Flows

- **Unreadable POM file**: logs the `FileSystemError`, skips the file, and continues scanning other modules.
- **Malformed XML**: emits a `PomParseError` tagged with the file path; results omit the version and mark the entry as unresolved.
- **Traversal cancellation**: abort signals stop the walk immediately and surface an `AbortError` so callers can retry later.

## API

### `scanWorkspaceForPom(workspaceRoot?: string): Promise<PomScanResult[]>`

- **Input**: absolute or relative path for the directory to traverse. When omitted, the current working directory is used.
- **Output**: alphabetically sorted array of `{ path, javaVersion }`, where `path` is the absolute file path and `javaVersion` is the detected version (or `undefined` when it cannot be resolved).
- **Behaviour**: recursively walks the directory, skipping common non-Maven folders (`.git`, `node_modules`, `target`). Each `pom.xml` delegates Java version extraction to `resolveJavaVersion`.

### `resolveJavaVersion(pomPath: string): Promise<string | undefined>`

- **Input**: absolute path to the `pom.xml` under analysis.
- **Output**: Java version string (for example `"21"` or `"1.8"`) or `undefined` when the configuration is missing.
- **Behaviour**: streams the XML instead of loading it entirely and checks sources in priority order:
  1. `<build><plugins><plugin>` with `<artifactId>maven-compiler-plugin</artifactId>` and `<configuration><release|source|target>`.
  2. Properties `maven.compiler.release`, `maven.compiler.source`, and `maven.compiler.target`.
  3. Property `java.version`.

The first match in the order above wins when multiple entries are present.

## Future Work

- Resolve chained property references (for example `${maven.compiler.release}`) via the POM property map.
- Support Maven profiles (`<profiles>`) that override compiler configuration.
- Allow configuration of directories ignored during traversal.
- Expose additional metadata such as `groupId`, `artifactId`, or module identifiers.
