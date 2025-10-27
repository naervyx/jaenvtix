# Provisioning Orchestrator

## Overview

The `orchestrator` module coordinates every provisioning step triggered by the extension. It scans workspace folders, resolves platform requirements, downloads toolchains, and updates project settings. The public factory exposes a single entry point that hides the wiring between modules.

## Responsibilities

- Resolve platform characteristics and prepare filesystem layout prerequisites before provisioning starts.
- Fan out workspace folders, detect requested Java versions, and queue provisioning tasks with progress reporting.
- Sequence downloader, extractor, Maven configuration, and VS Code updates for each project while tracking results.
- Aggregate per-project outcomes (success, skipped, failed) for UI reporting and telemetry.

## Dependencies

- **Scanner module** — enumerates `pom.xml` files and extracts requested Java versions.
- **Platform info + JDK mapper** — determine which distribution to download for the current OS/arch.
- **Downloader / Extractor / FS layout / Maven config / VS Code config** — execute provisioning steps end-to-end.
- **Reporter implementation** — optional structured logging and persistence of provisioning runs.

## Standard Error Flows

- **Download failure**: captures the thrown `DownloadFailedError`, records it in the project result, and continues with other workspaces.
- **Extraction failure**: aggregates the `AggregateError` emitted by the extractor and exposes a user-facing notification via the reporter.
- **VS Code settings write failure**: bubbles a `FileSystemError`, marks the project as failed, and stops further steps for that project only.
- **Global misconfiguration**: if platform detection or layout creation throws, the orchestrator aborts and surfaces a top-level `ProvisioningAbortedError`.

## API

### `createProvisioningOrchestrator(options?: OrchestratorOptions): ProvisioningOrchestrator`
- **Purpose**: Builds an orchestrator instance bound to shared dependencies (platform detection, downloader, extractor, etc.).
- **Options**:
  - `logger`: custom logger instance; defaults to `createLogger("jaenvtix.orchestrator")`.
  - `reporter`: optional `Reporter` implementation used to emit structured status updates.
  - `configuration`: VS Code configuration proxy read by retry policies and platform detection.
  - `dependencies`: overrides for individual modules, enabling targeted unit tests or alternate implementations.
  - `downloadOptions`: forwarded to the downloader for retry/onProgress wiring.
  - `window`: wrapper over VS Code `window` for user prompts.

### `runProvisioning(workspaceFolders): Promise<ProvisioningSummary>`
- **Workflow**:
  1. Validates input workspace folders.
  2. Detects platform information and ensures the base filesystem layout.
  3. Scans each workspace for `pom.xml` files and extracts declared Java versions.
  4. For each project with a declared version, provisions the required JDK:
     - Cleans temporary artifacts.
     - Resolves the distribution via `jdkMapper`.
     - Downloads archives to the temp directory with retry policies.
     - Extracts contents and synchronises Maven toolchains and settings.
     - Updates `.vscode/settings.json` to point at the new toolchain.
  5. Records success, skip, or failure per project and aggregates them per workspace.
  6. Returns the detected platform, layout paths, and project results.

### `detectJavaVersions(workspaceFolders): Promise<readonly DetectionWorkspaceResult[]>`
- **Purpose**: Fast path for inspection commands that only need to know which Java versions are requested.
- **Behaviour**: Reuses the scanner dependency to enumerate `pom.xml` files and returns their declared versions without provisioning anything.

## Reporting Hooks

When a `Reporter` is provided, each provisioning attempt opens a step named "Provision project". Attempt counts, project paths, and errors are recorded to disk so automated tooling can display progress.

## Retry Strategy

The orchestrator wires `RetryPolicy` from `@shared/retry` to wrap download and extraction steps. Users may be prompted to confirm additional retries when VS Code configuration requires it.
