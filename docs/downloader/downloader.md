# Artifact Downloader

## Overview

The `downloader` module retrieves remote artifacts and persists them to the local filesystem while offering checksum validation and progress reporting. It is responsible for supplying consistent binaries to downstream provisioning steps and integrates with the shared retry helper so transient network failures are handled transparently.

## Responsibilities

- Stream remote artifacts to deterministic filesystem locations using temporary files to avoid partial writes.
- Apply workspace checksum policy (`strict` or `best-effort`) before promoting an artifact to its final destination.
- Surface download progress through callback hooks for UI and logging integrations.
- Respect cancellation signals from user actions and propagate them through any retry sequence.

## Dependencies

- **`@shared/retry`** — performs exponential backoff with jitter and centralises retry logging metadata.
- **`@shared/logger`** — records structured diagnostics for download attempts and checksum validation.
- **Node `fs`/`stream` adapters** — injected for unit tests and to keep the implementation platform-neutral.

## Standard Error Flows

- **Network failure**: the module retries according to `retryOptions`; if exhaustion occurs it throws `DownloadFailedError` with the last response details.
- **Checksum mismatch**: emits a `ChecksumMismatchError`, deletes the temporary artifact, and leaves the destination untouched.
- **User cancellation**: abort signals short-circuit active downloads and surface an `AbortError` to the caller without retries.

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
  - Normalises checksum expectations according to workspace policy (`strict` vs `best-effort`).
  - Streams the response body to a temporary file to avoid partially written destinations.
  - Emits progress updates and maintains a running hash while writing chunks.
  - Verifies digests before atomically replacing the destination.
  - Retries transient failures while respecting user cancellation via abort signals.

## Integration Guidelines

- Pass through VS Code configuration when available so checksum policies honour user preferences.
- Provide an `AbortSignal` when downloads should be cancellable (for example, when bound to a user action).
- Use the `onProgress` hook to update UI elements such as progress notifications.
- Avoid reusing destination paths across concurrent downloads to prevent contention while temporary files are in use.

## Related Utilities

- `@shared/retry`: implements exponential backoff, jitter, and retry logging.
- `@shared/logger`: surfaces diagnostic information while keeping retry telemetry consistent across modules.
