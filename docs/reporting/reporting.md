# Reporting

## Overview

The `reporting` module captures provisioning progress in a structured JSON file and optionally surfaces toast messages via the VS Code window API. It offers a minimal interface for starting, finishing, or failing steps while persisting attempt metadata.

## Responsibilities

- Create and maintain a durable execution report describing each provisioning step and its attempts.
- Provide hooks for user-facing notifications tied to success or failure transitions.
- Persist metadata in a format consumable by CI tooling or support investigations.
- Offer deterministic testing seams for timestamps, UUIDs, and filesystem interactions.

## Dependencies

- **Node `fs` adapters** — perform report directory creation and JSON writes.
- **`@shared/logger`** — logs persistence failures or serialization problems.
- **VS Code window bridge** — optional adapter used to show information or error messages when steps finish.

## Standard Error Flows

- **Filesystem write failure**: throws `ReportPersistenceError` and leaves the in-memory report untouched so callers may retry.
- **Notification failure**: logs the VS Code error but does not fail the provisioning flow; the step remains updated in the report.
- **Invalid metadata**: rejects the operation with `InvalidStepMetadataError`, preventing malformed entries from being committed.

## API

### `Reporter`
The interface exposes five methods:
- `startStep(name, metadata?)`: Opens a new step, creates a UUID, and stores the first attempt.
- `endStep(handle, metadata?)`: Marks the active attempt as successful, updates timestamps, and optionally records attempt metadata.
- `failStep(handle, error, metadata?)`: Ends the active attempt with a serialized error, shows an error message when a window adapter exists, and leaves the step available for further retries.
- `getReport()`: Returns the in-memory `ExecutionReport` structure.
- `reset()`: Clears persisted data and removes the report file on disk.

### `ReporterOptions`
- `reportDirectory` / `reportFileName`: Control where the JSON report is written (default: `${tmpdir()}/jaenvtix/report.json`).
- `window`: Optional adapter used to show information or error messages when steps finish.
- `clock` and `idGenerator`: Allow deterministic testing of timestamps and UUIDs.
- `fileSystem`: Partial adapter for `mkdir`/`writeFile`, enabling in-memory fakes.

## Report Format

Reports follow the `ExecutionReport` schema:
- `runId`: UUID assigned when the reporter is initialised.
- `createdAt` / `updatedAt`: ISO timestamps capturing lifecycle events.
- `steps`: Array of step records, each containing attempts with duration, status, and optional error details.

## Persistence Model

A lazily created directory hosts the JSON report. Each state change queues a write operation to avoid concurrent filesystem access. Consumers can read the latest data via `getReport()` without touching the disk.
