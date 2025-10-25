# Archive Extractor

## Overview

The `extractor` module processes compressed archives (ZIP and TAR variants) and materializes their contents in the requested destination. It prefers native tools such as `unzip` and `tar` when available, but it also ships a full TypeScript fallback and a manual prompt that lets the user pick an already extracted folder.

## API

### `extract(archivePath: string, destination: string, formatHint?: string): Promise<string>`

- **Input:**
  - `archivePath`: absolute path to the archive file.
  - `destination`: directory that should receive the extracted files. Created automatically if it does not exist.
  - `formatHint`: optional hint to force the format (`"zip"`, `"tar"`, `"tar.gz"`).
- **Output:** resolves with the destination path as soon as any extraction flow completes successfully.
- **Behavior:**
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
- Uses the same temporary directories and path checks, minimizing the risk of overwriting files outside the target folder.

### Manual prompt

- When every automated strategy fails, asks the user (via VS Code) to manually select an already extracted folder.
- Normalizes and validates the returned path before finishing the operation.

## Integration Guidelines

- Prefer passing a `formatHint` when the archive format is known to avoid extension-based heuristics.
- Consider exposing a configuration that lets users opt in or out of native tools when desired.
- Capture and log error messages returned in the `AggregateError` to simplify failure diagnostics.
- Ensure write permissions in the destination folder and its temporary subdirectories while the module runs.

## Related Resources

- `src/modules/extractor/index.ts`: main module implementation.
- `setSpawnImplementation` / `setManualExtractionPrompt`: handy injection points for automated tests.
