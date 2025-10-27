# Archive Extractor

## Overview

The `extractor` module processes compressed archives (ZIP and TAR variants) and materialises their contents in the requested destination. It prefers native tools such as `unzip` and `tar` when available, but it also ships a full TypeScript fallback and a manual prompt that lets the user pick an already extracted folder.

## Responsibilities

- Detect supported archive formats and dispatch to the best available extraction strategy.
- Guarantee destination safety by validating entry names against path traversal attempts before writing files.
- Provide graceful fallbacks (JavaScript implementation and manual prompt) when system tools are unavailable or fail.
- Normalise success output so downstream steps can rely on a stable extracted directory path.

## Dependencies

- **`@shared/tmp` utilities** — create deterministic temporary directories under the target destination.
- **`@shared/logger`** — records warnings and failures when native commands error or validation rejects entries.
- **VS Code UI bridge** — supplies the manual folder picker used as the final fallback.

## Standard Error Flows

- **Native tool failure**: surfaces a wrapped `NativeExtractionError` with captured stderr; the module automatically retries with the JavaScript fallback.
- **Validation rejection**: throws `EntryValidationError` before extraction starts to avoid partial writes; callers should notify the user the archive is unsafe.
- **User cancelled manual prompt**: returns an `AbortError` bubbling from the VS Code UI so orchestrators can stop provisioning gracefully.

## API

### `extract(archivePath: string, destination: string, formatHint?: string): Promise<string>`

- **Input:**
  - `archivePath`: absolute path to the archive file.
  - `destination`: directory that should receive the extracted files. Created automatically if it does not exist.
  - `formatHint`: optional hint to force the format (`"zip"`, `"tar"`, `"tar.gz"`).
- **Output:** resolves with the destination path as soon as any extraction flow completes successfully.
- **Behaviour:**
  - Detects the format automatically when no hint is provided.
  - Ensures the destination directory exists and delegates extraction to three cascading strategies: native, JavaScript fallback, and manual prompt.
  - Stores intermediate results inside temporary subdirectories and moves vetted files to the final destination, preserving pre-existing contents that do not collide with the extracted files.
  - Validates entry names before invoking native tools to block absolute paths or `..` sequences that could escape the destination directory.

## Extraction Strategies

### Native extraction

- Uses `tar` or `unzip` on macOS/Linux and `tar`/`Expand-Archive` on Windows.
- Creates a temporary workspace inside the destination to run the system tool and, after success, moves the validated result into the final folder.
- Rejects entries with suspicious paths before invoking the native binary.

### JavaScript extraction

- Implements direct ZIP processing and a TAR/TAR.GZ pipeline in TypeScript.
- Uses the same temporary directories and path checks, minimising the risk of overwriting files outside the target folder.

### Manual prompt

- When every automated strategy fails, asks the user (via VS Code) to manually select an already extracted folder.
- Normalises and validates the returned path before finishing the operation.

## Integration Guidelines

- Prefer passing a `formatHint` when the archive format is known to avoid extension-based heuristics.
- Consider exposing a configuration that lets users opt in or out of native tools when desired.
- Capture and log error messages returned in the `AggregateError` to simplify failure diagnostics.
- Ensure write permissions in the destination folder and its temporary subdirectories while the module runs.

## Related Resources

- `src/modules/extractor/index.ts`: main module implementation.
- `setSpawnImplementation` / `setManualExtractionPrompt`: handy injection points for automated tests.
