# Platform Info

## Overview

The `platformInfo` module detects the current operating system and CPU architecture in a normalised format so the extension can reason about cross-platform behaviour safely. It combines Node.js primitives with optional overrides configured by users in `settings.json`.

## Responsibilities

- Provide a canonical mapping of OS/architecture identifiers for all downstream modules.
- Honour workspace overrides exposed via `jaenvtix.platform.override` for advanced scenarios and testing.
- Surface helper utilities that collapse OS/arch aliases into the small set supported by Jaenvtix installers.
- Offer deterministic output so caches and report files remain stable across invocations.

## Dependencies

- **Node `os` module** — supplies default platform and architecture values.
- **VS Code configuration bridge** — reads user overrides and validation settings.
- **Normalisation helpers** — shared utilities converting aliases such as `win32` or `aarch64` into canonical values.

## Standard Error Flows

- **Unsupported override**: raises `InvalidPlatformOverrideError` identifying the invalid tokens and falls back to host detection.
- **Host detection failure**: extremely rare, but when `os.platform()` or `os.arch()` returns unexpected values, the module returns `"unknown"` variants and logs a warning.
- **Configuration read failure**: propagates the VS Code configuration error, signalling that the settings provider is unavailable.

## API

### `detectPlatform(options?: DetectPlatformOptions): PlatformInfo`

- **Input**: optional object containing explicit `platform` and `arch` overrides (useful for tests) plus a custom `WorkspaceConfiguration` instance for reading user settings.
- **Output**: `{ os, arch }` object with normalised values. Supported operating systems include `"windows"`, `"macos"`, `"linux"`, and others. Supported architectures include `"x64"`, `"arm64"`, `"arm"`, and additional variants.
- **Behaviour**:
  - Reads `jaenvtix.platform.override` from VS Code and applies the `normalizeOperatingSystem` and `normalizeArchitecture` helpers.
  - Falls back to `os.platform()` and `os.arch()` (or values supplied in `options`) when no valid override is provided.
  - Returns `"unknown"` when an input cannot be mapped to a recognised alias.

### Input Normalisation

- **Operating systems**: accepted aliases include variants such as `"win32"`, `"darwin"`, and `"osx"`, all converging to a canonical enumeration.
- **Architectures**: converts identifiers like `"amd64"`, `"x86_64"`, `"aarch64"`, and `"armv7l"` to the standardised values consumed across the extension.

## Integration Guidelines

- Use `detectPlatform()` as the single source of truth for platform-specific decisions. Avoid calling `os.platform()` or `os.arch()` directly elsewhere.
- For tests, supply `platform` and `arch` through the options to validate multi-platform scenarios without relying on the host machine.
- When exposing manual overrides to users, document `jaenvtix.platform.override` in the extension configuration guide.

## Future Work

- Provide utilities to format human-readable platform names (for example `"Windows x64"`).
- Support additional architectures as user demand emerges.
- Validate that manually configured values map to combinations supported by the broader extension.
