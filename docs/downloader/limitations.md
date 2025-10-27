# Artifact Downloader Limitations

1. **No resume support.** Downloads start from the beginning when retried; HTTP range requests and partial file reuse are not implemented.
2. **Single destination writer.** Concurrent downloads targeting the same path can race and overwrite each other because the module assumes exclusive ownership of the destination.
3. **Checksum algorithms must be known upfront.** The module cannot auto-detect algorithms; callers must configure the correct digest length or override explicitly.
4. **Fetch streaming compatibility.** Environments lacking WHATWG stream support (or `Readable.fromWeb`) cannot pipe certain response bodies, causing downloads to fail early.
5. **Temporary file cleanup best-effort.** Unexpected process termination can leave behind `.download-*` files since cleanup only runs after handled errors.
