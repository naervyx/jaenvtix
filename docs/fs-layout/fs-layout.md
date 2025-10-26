# Filesystem Layout

## Overview

The `fsLayout` module centralises every filesystem path used by the extension. It calculates where JDK distributions, Maven wrappers, and temporary files live under the `.jaenvtix` home directory. Exposed helpers make directory creation idempotent and provide deterministic locations per Java version.

## Responsibilities

- Resolve the base Jaenvtix directory tree according to platform conventions and workspace overrides.
- Provide per-version paths for provisioned JDKs and the coupled Maven wrapper tooling.
- House cleanup utilities that keep the temporary workspace pristine between provisioning attempts.
- Expose a single source of truth for toolchain and cache locations so orchestration modules avoid duplication.

## Dependencies

- **Node `fs`/`path` adapters** — injected to guarantee unit tests can operate in isolation.
- **`@shared/logger`** — records filesystem creation or cleanup failures for observability.
- **Platform detection helpers** — determine Windows-specific suffixes for executables.

## Standard Error Flows

- **Directory creation failure**: throws `FileSystemError` with the failing path when permissions or disks block `ensureBaseLayout`.
- **Temporary cleanup failure**: logs non-fatal errors for individual entries and rethrows unexpected `rm` exceptions to the orchestrator.
- **Invalid version string**: `getPathsForVersion` validates the input and raises `InvalidVersionError` when the format is unsupported.

## API

### `ensureBaseLayout(options?: EnsureBaseLayoutOptions): Promise<BaseLayoutPaths>`
- **Purpose**: Creates the base `.jaenvtix` folder and its `temp` subdirectory if they do not exist yet.
- **Key options**: `baseDir` and `homeDir` override default locations during tests; `fs` swaps the `mkdir` implementation.
- **Returns**: `{ baseDir, tempDir }` with absolute paths.

### `getPathsForVersion(version: string, options?: LayoutBaseOptions): VersionLayoutPaths`
- **Purpose**: Derives all paths for a specific Java version, including the dedicated Maven wrapper.
- **Computed paths**:
  - `majorVersionDir`: container directory per major Java version (`jdk-17`, `jdk-21`, ...).
  - `jdkHome`: root directory for the extracted JDK.
  - `mavenDir`, `mavenBin`, `mavenWrapper`, `mavenDaemon`: Maven bundle paths colocated with the JDK.
  - `toolchainsFile`: Maven `toolchains.xml` in the user's `.m2` directory.
- **Platform nuances**: `mavenWrapper` and `mavenDaemon` are suffixed with `.cmd`/`.exe` on Windows.

### `cleanupTempDirectory(options: CleanupTempDirectoryOptions): Promise<void>`
- **Purpose**: Deletes everything inside the `temp` directory before a provisioning attempt.
- **Behaviour**: Ignores missing directories and permission errors for individual entries, while surfacing unexpected filesystem failures.
- **Extensibility**: Accepts custom `readdir` and `rm` implementations for testing.

## Integration Tips

- Call `ensureBaseLayout` once at activation to prime directories before downloads occur.
- Reuse `getPathsForVersion` in every module that needs to locate Maven binaries or the JDK root to avoid duplicated path logic.
- Run `cleanupTempDirectory` before reattempting provisioning so stale partial downloads do not leak into retries.
