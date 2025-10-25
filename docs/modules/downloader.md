# Artifact Downloader

## Overview

The `downloader` module retrieves remote artifacts and persists them to the local filesystem while offering checksum validation and progress reporting. It delegates retries to the shared `retry` helper so transient network failures are handled transparently.

## API

### `downloadArtifact(url: string, options: DownloadArtifactOptions): Promise<string>`

- **Input**:
  - `url`: HTTP(S) endpoint that serves the artifact.
  - `options.destination`: absolute path where the file should be stored. Parent directories are created automatically.
  - `options.expectedChecksum` / `options.checksumAlgorithm`: optional verification parameters accepted by the checksum policy.
  - `options.fetchImplementation`: optional override for `fetch`, useful in tests.
  - `options.fetchOptions`: custom `fetch` init bag merged with the internal abort signal wiring.
  - `options.signal`: `AbortSignal` that cancels in-flight downloads and short-circuits retry attempts.
  - `options.onProgress`: callback invoked with incremental download stats as bytes are written to disk.
  - `options.retryOptions`: tuning knobs forwarded to the shared retry helper.
  - `options.logger`: logger instance used for retry and cleanup diagnostics.
  - `options.fileSystem`, `options.createWriteStream`, `options.temporaryPathProvider`: dependency injection seams for tests.
- **Output**: resolves to the destination path after the file is downloaded, checksum-validated (when configured), and moved into place.
- **Behaviour**:
  - Normalizes checksum expectations according to workspace policy (`strict` vs `best-effort`).
  - Streams the response body to a temporary file to avoid partially written destinations.
  - Emits progress updates and maintains a running hash while writing chunks.
  - Verifies digests before atomically replacing the destination.
  - Retries transient failures while respecting user cancellation via abort signals.

## Integration Guidelines

- Pass through VS Code configuration when available so checksum policies honor user preferences.
- Provide an `AbortSignal` when downloads should be cancellable (for example, when bound to a user action).
- Use the `onProgress` hook to update UI elements such as progress notifications.
- Avoid reusing destination paths across concurrent downloads to prevent contention while temporary files are in use.

## Related Utilities

- `@shared/retry`: implements exponential backoff, jitter, and retry logging.
- `@shared/logger`: surfaces diagnostic information while keeping retry telemetry consistent across modules.
