# Provisioning Orchestrator — Known Limitations

- **Sequential provisioning**: Projects are processed serially. A large workspace with many `pom.xml` files may take significant time because downloads and extractions do not run in parallel.
- **Single-version expectation**: The scanner only surfaces one Java version per project. Multi-module builds that rely on toolchains, profiles, or properties for alternate versions are marked as "skipped".
- **Minimal retry UX**: Retry confirmation relies on VS Code warnings and does not surface fine-grained progress or cancellation prompts beyond the injected `AbortSignal`.
- **No partial rollback**: When provisioning fails mid-way, previously written files (downloads, toolchains, settings) remain in place. Follow-up attempts rely on `cleanupTempDirectory` to remove transient artifacts only.
