# Provisioning Flow (High Level)

1. **Detect platform** — resolve the host operating system and architecture, honoring any `jaenvtix.platform.override` settings.
2. **Ensure base layout** — create `~/.jaenvtix` directories and scratch space used for downloads and per-version artifacts.
3. **Enumerate workspaces** — iterate over the VS Code workspace folders selected for provisioning.
4. **Scan Maven projects** — walk each workspace to find `pom.xml` files and extract Java version hints.
5. **Filter unsupported projects** — skip entries without a Java version and continue with the remaining projects.
6. **Resolve distributions** — map the requested Java version and detected platform to a vendor-specific download descriptor.
7. **Download archives** — stream the chosen JDK package with retry, checksum validation, and temporary-file staging.
8. **Extract artifacts** — unpack the archive into the computed layout, preferring native tools with fallbacks.
9. **Sync Maven metadata** — update `toolchains.xml`, ensure `settings.xml` exists, and keep per-version Maven binaries aligned.
10. **Update workspace settings** — write `.vscode/settings.json`, notify the reporter of the outcome, and record the summary.
