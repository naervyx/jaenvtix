# Architecture Overview

## Coding Standards

- TypeScript files must pass the configured ESLint ruleset. Key conventions include enforcing camelCase/PascalCase naming, consistent type imports, controlled function complexity, and sorted import declarations.
- Always enable the strictest type-safety features. `tsconfig.json` enables `strict`, `noImplicitOverride`, and related options. Avoid disabling these flags without architectural review.
- Prefer immutable data structures and favour pure functions. When mutation is required, encapsulate it carefully and document the rationale.

## Shared Utilities

- Cross-cutting helpers reside in `src/shared/`. Utilities exported from this directory should be framework-agnostic and reusable across features.
- Use the `Result<T, E>` helpers to model recoverable errors explicitly. Functions should return `Result` instead of throwing when the caller can handle expected failure modes.
- Use the structured `createLogger` factory for consistent logging metadata. Child loggers can enrich logs with contextual fields.
- Employ `retry` and `retryResult` when calling operations that may transiently fail. Configure retry attempts, delays, and jitter thoughtfully to balance resilience and responsiveness.

## Module Boundaries

- Imports from shared utilities must use the `@shared/*` path alias configured in `tsconfig.json`. This keeps import statements concise and resilient to directory restructuring.
- Feature modules should compose shared helpers rather than reimplementing core behaviours (logging, retry, error modelling).
- Keep VS Code extension entry points focused on lifecycle coordination (`activate`, `deactivate`). Delegate domain logic to dedicated modules or shared utilities.
- See [JDK Distribution Mapper](../jdk-mapper/jdk-mapper.md) for details on how vendor manifests and fallback selection are implemented.

## Module Documentation

- [Workspace Scanner](../scanner-pom/scanner-pom.md) — outlines how the extension walks Maven workspaces and extracts Java versions.
- [Platform Info](../platform-info/platform-info.md) — explains how the operating system and architecture are detected and normalised, including user overrides.
- [JDK Distribution Mapper](../jdk-mapper/jdk-mapper.md) — details how curated manifests and fallback rules resolve compatible distributions.
- [Artifact Downloader](../downloader/downloader.md) — covers how remote archives are fetched, validated, and cached for reuse.
- [Archive Extractor](../extractor/extractor.md) — documents supported archive formats and directory safety checks performed during extraction.
- [Filesystem Layout](../fs-layout/fs-layout.md) — specifies where provisioned JDKs are stored on disk and how symlinks expose active toolchains.
- [Maven Configuration](../maven-config/maven-config.md) — explains how `toolchains.xml` files are generated and patched for detected runtimes.
- [Provisioning Orchestrator](../orchestrator/orchestrator.md) — shows how scanning, downloading, extraction, and configuration are coordinated.
- [Reporting](../reporting/reporting.md) — describes telemetry and user-facing status updates emitted during provisioning.
- [VS Code Workspace Config](../vscode-config/vscode-config.md) — details recommended workspace settings and extension toggles for contributors.

Every new module must ship with a guide listed here. Update this section whenever you add or move files in `docs/` so navigation remains predictable.

## Module Limitations

- [Workspace Scanner Limitations](../scanner-pom/limitations.md) — current gaps in the Maven scanner module, including unsupported profiles and property indirection.
- [Platform Info Limitations](../platform-info/limitations.md) — constraints around alias coverage, override validation, and architecture detection.
- [JDK Distribution Mapper Limitations](../jdk-mapper/limitations.md) — known constraints of the manifest-driven resolver, such as vendor coverage and preview version handling.
- [Artifact Downloader Limitations](../downloader/limitations.md) — network retry behaviours, checksum coverage, and cache invalidation considerations.
- [Archive Extractor Limitations](../extractor/limitations.md) — supported archive types, path traversal protections, and file permission handling.
- [Filesystem Layout Limitations](../fs-layout/limitations.md) — disk footprint expectations and symlink availability on different platforms.
- [Maven Configuration Limitations](../maven-config/limitations.md) — toolchains generation edge cases and compatibility constraints with custom Maven setups.
- [Provisioning Orchestrator Limitations](../orchestrator/limitations.md) — sequencing assumptions, cancellation handling, and dependency preconditions.
- [Reporting Limitations](../reporting/limitations.md) — telemetry opt-in requirements and gaps in localisation for status messages.
- [VS Code Workspace Config Limitations](../vscode-config/limitations.md) — shared workspace restrictions and scenarios requiring manual overrides.

## Testing & Tooling

- Run `npm run lint` and `npm run check-types` before submitting changes. Both commands must succeed in continuous integration.
- Prefer deterministic unit tests that isolate behaviour from VS Code APIs by mocking extension APIs when needed.
- When introducing new utilities or conventions, update this overview to keep the documentation aligned with the codebase.
