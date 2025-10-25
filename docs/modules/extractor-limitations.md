# Archive Extractor Limitations

## Native tools unavailable

Environments without `tar`, `unzip`, or an executable `powershell` rely exclusively on the JavaScript fallback, which can be noticeably slower for large archives.

## Limited format support

The module currently supports `zip`, `tar`, and `tar.gz` files only. Archives with alternative compression schemes (for example, `tar.bz2`) trigger the error flow and require manual extraction.

## Entry validation

The validation process rejects entries that contain invalid characters or traversal attempts. This can block some rare archives with unusual names, requiring manual intervention.
