# Reporting

## Responsibilities
- Persist structured execution reports that capture provisioning steps, attempts, durations, and errors.
- Surface user-facing notifications for successful and failed steps via the VS Code window API.
- Provide an interface for starting, ending, and failing steps so the orchestrator can record progress consistently.
- Manage report files on disk, including directory initialization and serialized JSON snapshots.

## Dependencies
- Node.js `crypto`, `fs`, `path`, and `os` modules for identifiers, persistence, and default locations.
- Optional VS Code window adapter to publish toast notifications.
- Clock and identifier factories that can be overridden in tests for deterministic behavior.

## Standard error flows
- Throws when consumers attempt to end or fail unknown steps, ensuring misuse is surfaced early.
- Serializes unknown error inputs into stable JSON structures before writing them to the report.
- Chains persistence operations to avoid race conditions; IO failures propagate to the caller for visibility.
