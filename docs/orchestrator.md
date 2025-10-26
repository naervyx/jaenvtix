# Orchestrator

## Responsibilities
- Coordinate provisioning and detection workflows for all workspace folders, ensuring results are grouped per workspace and per project.
- Establish shared provisioning context such as platform detection, base layout discovery, and retry policies before iterating over projects.
- Reuse downloaded artifacts across projects targeting the same Java version and update VS Code workspace settings once provisioning succeeds.
- Drive reporting hooks so that provisioning progress and failures are surfaced through the shared reporter interface.

## Dependencies
- [`detectPlatform`](./platform-info.md) to normalize the host operating system and architecture for download resolution.
- [`scanWorkspaceForPom`](./scanner-pom.md) to enumerate Maven projects and extract their requested Java versions.
- [`resolveJdkDistribution`](./jdk-mapper.md) for vendor selection and download metadata.
- [`ensureBaseLayout` / `cleanupTempDirectory` / `getPathsForVersion`](./fs-layout.md) to manage the provisioning directories on disk.
- [`downloadArtifact`](./downloader.md) to fetch JDK archives with retry and checksum validation.
- [`extract`](./extractor.md) to unpack the downloaded archives into their final location.
- [`syncToolchains` and `ensureSettings`](./maven-config.md) so Maven shares the new toolchain entries and default settings.
- [`updateWorkspaceSettings`](./vscode-config.md) to pin VS Code project settings to the provisioned toolchain.
- Optional [`Reporter`](./reporting.md) implementation for progress tracking and telemetry.

## Standard error flows
- Rejects provisioning when no workspace folders are supplied, mirroring the runtime guard in `runProvisioning`.
- Skips individual projects whose `pom.xml` does not define a Java version, logging the decision while keeping the workspace iteration alive.
- Wraps provisioning steps inside the shared retry policy; failures trigger retry logging, optional user confirmation prompts, and reporter failure tracking.
- Any download or extraction error clears the cached artifact promise for that Java version so subsequent attempts can retry from scratch.
- Exceptions from dependent modules propagate after reporter bookkeeping, ensuring the project result is marked as `failed` with the captured error instance.
