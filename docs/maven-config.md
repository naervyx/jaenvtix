# Maven Configuration

## Responsibilities
- Merge provisioned toolchains into `~/.m2/toolchains.xml`, deduplicating vendor/version pairs.
- Ensure a baseline `settings.xml` exists so Maven honors repository and mirror configuration.
- Normalize XML content with predictable whitespace to keep diffs minimal across repeated runs.

## Dependencies
- Node.js `fs`, `os`, and `path` modules for file system access and default location resolution.
- XML string helpers that escape values and collapse blank lines while preserving the document structure.
- Toolchain information emitted by the orchestrator once extraction succeeds.

## Standard error flows
- Creates parent directories when missing; unexpected IO failures propagate to the caller with original error codes.
- Treats missing files as initialization scenarios, seeding default XML documents before continuing.
- Ignores malformed toolchain entries lacking versions, ensuring the original content is preserved without modification.
