# Provisioning Flow

The diagram below outlines the ten high-level stages the extension follows when provisioning a workspace:

1. **Activation** — Extension activates, initialises logging, and calls `ensureBaseLayout` to prepare directories.
2. **Workspace Discovery** — Collect workspace folders from VS Code and hand them to the orchestrator.
3. **Platform Detection** — `platformInfo` resolves OS/architecture and applies any configured overrides.
4. **Workspace Scan** — `scannerPom` walks folders, identifies `pom.xml` files, and extracts requested Java versions.
5. **Distribution Resolution** — `jdkMapper` selects the appropriate vendor, download URL, and checksum metadata per version.
6. **Temporary Cleanup** — `fsLayout.cleanupTempDirectory` removes stale artefacts ahead of new downloads.
7. **Artifact Download** — `downloader` retrieves the selected archives with retry and checksum policies applied.
8. **Archive Extraction** — `extractor` expands the archives into the per-version directories, applying safety checks.
9. **Configuration Sync** — `mavenConfig` updates `toolchains.xml`/`settings.xml`, and `vscodeConfig` rewrites workspace settings.
10. **Reporting & Summary** — `reporting` persists the run outcome, and the orchestrator returns a structured provisioning summary.

Each module document provides deeper detail for the responsibilities, dependencies, and error flows encountered in these stages.
