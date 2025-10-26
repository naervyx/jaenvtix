# Maven Configuration — Known Limitations

- **XML manipulation is string-based**: The merger strips and appends `<toolchain>` blocks using regular expressions. Complex formatting, comments, or namespaces beyond the default schema are not preserved.
- **No validation of Maven vendor aliases**: Incoming vendor identifiers are inserted verbatim. Upstream callers must ensure they match Maven's expectations.
- **Single `javaHome` per entry**: The module writes one `javaHome` per vendor/version combination and does not validate whether the directory actually exists on disk.
