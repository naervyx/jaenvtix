# Reporting — Known Limitations

- **No streaming reader**: Consumers must wait for the orchestrator to call `persist()`; there is no event stream or incremental flush for long-running steps.
- **Single-run state**: The in-memory report is reset manually. Multiple orchestrator runs in the same session share the same reporter instance unless the caller creates a new one.
- **Basic window messaging**: Success and failure messages rely on simple VS Code information/error toasts. There is no progress notification integration or localization support.
