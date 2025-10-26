# Downloader

## Responsibilities
- Stream remote artifacts to disk while tracking progress and optional checksum validation.
- Normalize workspace configuration to decide whether strict or best-effort checksum policies should apply.
- Persist downloads via temporary files before atomically replacing the final destination to avoid partial writes.
- Integrate with the shared retry policy so transient transport failures are automatically retried.

## Dependencies
- Node.js primitives such as `fs`, `stream`, and `crypto` for file IO and digest computation.
- Global or injected `fetch` implementation to issue HTTP requests.
- `RetryPolicy` and `retry` helpers from `@shared/retry` to coordinate retries and cancellation.
- Optional logger instances to emit retry diagnostics and temporary file cleanup messages.
- Optional VS Code configuration handle to read checksum policy overrides.

## Standard error flows
- Throws when the `fetch` implementation is not available or when the HTTP response is not successful.
- Validates the presence of a response body; missing bodies result in immediate failures that surface to callers.
- Aborts the transfer when the provided `AbortSignal` is triggered and reports the cancellation upstream.
- Compares computed and expected checksums; mismatches trigger an error after the temporary file is removed.
- Cleans up temporary files on any failure path (download errors, checksum mismatch, or write issues) before rethrowing.
