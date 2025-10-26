# Maven Configuration

## Overview

The `mavenConfig` module keeps Maven metadata aligned with the toolchains provisioned by the extension. It manages two XML files in the user's `.m2` directory:

- `toolchains.xml` contains `<toolchain>` entries for each provisioned vendor/version pair.
- `settings.xml` ensures Maven has a baseline configuration even when the user never created one.

## Responsibilities

- Create or update Maven `toolchains.xml` to reflect the active JDKs that Jaenvtix manages.
- Provision a minimal yet valid `settings.xml` file to stabilise Maven execution on fresh machines.
- Avoid redundant disk writes by diffing current XML contents before persisting updates.
- Normalise vendor/version metadata so downstream commands share consistent identifiers.

## Dependencies

- **`@shared/xml` helpers** — parse and serialise XML while preserving formatting expectations.
- **Filesystem adapters** — injected for testing and to support different environments.
- **`fsLayout` module** — supplies canonical paths for Maven configuration targets.

## Standard Error Flows

- **XML parse failure**: throws `ToolchainsParseError` including the offending path and raw snippet to aid debugging.
- **Filesystem permission issues**: surfaces `FileSystemError` when `.m2` directories cannot be created or written.
- **Schema validation warning**: logs (via `@shared/logger`) when user-provided XML deviates but remains readable; execution continues with best-effort merging.

## API

### `syncToolchains(toolchain: ToolchainEntry, options?: SyncToolchainsOptions): Promise<void>`
- **Purpose**: Adds or updates `<toolchain>` blocks matching a vendor and list of Java versions.
- **Behaviour**:
  - Creates the parent directory automatically.
  - Reads existing contents, removing entries that target the same vendor and version list.
  - Appends sanitised blocks that reference the normalised `javaHome` path.
  - Writes back only when the final XML changes to avoid needless disk churn.
- **Extensibility**: Accepts dependency-injected filesystem primitives and a custom toolchains file path for tests.

### `ensureSettings(targetPath?: string, options?: EnsureSettingsOptions): Promise<string>`
- **Purpose**: Guarantees a valid `settings.xml` file exists.
- **Behaviour**: Creates parent directories, writes a minimal schema-compliant XML when missing, and returns the resolved path.

## Usage Notes

- Always provide trimmed version strings when constructing `ToolchainEntry` objects; duplicates are collapsed automatically.
- Invoke `ensureSettings` before pointing Maven commands to the `.m2` directory on fresh machines.
- When integrating with external tooling, consider passing a mocked filesystem to isolate side effects in unit tests.
