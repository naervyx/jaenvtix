# Scanner (pom.xml)

## Responsibilities
- Traverse workspace folders to locate Maven `pom.xml` files while skipping ignored directories.
- Parse `pom.xml` streams incrementally to recover Java version hints from properties and `maven-compiler-plugin` declarations.
- Return ordered scan results so downstream modules can process projects deterministically.

## Dependencies
- Node.js `fs` and `path` modules for directory traversal and streaming reads.
- Internal XML parsing helpers that maintain element stacks and plugin states.
- Shared ignore lists to avoid traversing build outputs or dependencies (e.g., `target`, `node_modules`).

## Standard error flows
- Propagates directory read failures so the orchestrator can report permission or IO issues early.
- Rejects malformed XML by surfacing parse errors encountered during the streaming scan.
- Treats missing Java version metadata as a soft failure by returning results without the `javaVersion` field, allowing the orchestrator to skip provisioning gracefully.
