# File-system Layout

## Responsibilities
- Provide deterministic directory structures under `~/.jaenvtix` for caches, temporary artifacts, and per-version assets.
- Ensure base directories exist before provisioning workflows rely on them.
- Derive per-version paths for JDK homes, Maven binaries, wrappers, and toolchains metadata.
- Expose helpers for cleaning temporary folders without disturbing successful artifacts.

## Dependencies
- Node.js `fs`, `os`, and `path` modules for directory management and environment introspection.
- Reused helper logic for normalizing error messages and filtering common permission or missing-directory errors.

## Standard error flows
- Validates version strings and throws descriptive errors when values are missing or cannot produce a major segment.
- Converts low-level file-system errors into user-friendly messages, specifically highlighting permission issues.
- Ignores missing temporary directories during cleanup yet propagates unexpected `readdir` or `rm` failures.
