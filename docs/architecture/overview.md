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
- See [JDK Distribution Mapper](./jdk-mapper.md) for details on how vendor manifests and fallback selection are implemented.

## Module Documentation

- [Workspace Scanner](../modules/scanner-pom.md) — outlines how the extension walks Maven workspaces and extracts Java versions.
- [Platform Info](../modules/platform-info.md) — explains how the operating system and architecture are detected and normalized, including user overrides.
- [JDK Distribution Mapper](./jdk-mapper.md) — details how curated manifests and fallback rules resolve compatible distributions.

Every new module must ship with a guide listed here. Update this section whenever you add or move files in `docs/modules` so navigation remains predictable.

## Module Limitations

- [Workspace Scanner Limitations](../modules/scanner-pom-limitations.md) — current gaps in the Maven scanner module, including unsupported profiles and property indirection.
- [Platform Info Limitations](../modules/platform-info-limitations.md) — constraints around alias coverage, override validation, and architecture detection.
- [JDK Distribution Mapper Limitations](../modules/jdk-mapper-limitations.md) — known constraints of the manifest-driven resolver, such as vendor coverage and preview version handling.

## Testing & Tooling

- Run `npm run lint` and `npm run check-types` before submitting changes. Both commands must succeed in continuous integration.
- Prefer deterministic unit tests that isolate behaviour from VS Code APIs by mocking extension APIs when needed.
- When introducing new utilities or conventions, update this overview to keep the documentation aligned with the codebase.
