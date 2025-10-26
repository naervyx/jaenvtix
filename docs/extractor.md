# Extractor

## Responsibilities
- Detect archive formats (ZIP, TAR, TAR.GZ) and choose the appropriate extraction strategy automatically.
- Prefer native OS tools when available, falling back to an in-process TypeScript implementation and finally a manual prompt.
- Sanitize archive entries to block path traversal before materializing files in the destination directory.
- Manage temporary workspaces during extraction to ensure partially expanded archives never pollute the final directory.

## Dependencies
- Node.js `child_process`, `fs`, and `zlib` modules for invoking native tools and handling decompression streams.
- Optional `spawn` implementation and manual prompt function that can be injected during testing.
- File system utilities shared with the downloader to create, move, and clean directories.

## Standard error flows
- Throws when it cannot infer the archive format from the path or provided hint.
- Captures and aggregates errors from native, JavaScript, and manual strategies, surfacing them as a single `AggregateError`.
- Records failed attempts from each strategy so the caller receives meaningful diagnostics for troubleshooting.
- Propagates validation errors when archive entries attempt to escape the destination folder or include unsupported metadata.
