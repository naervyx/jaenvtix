# JDK Mapper

## Responsibilities
- Map requested Java versions, operating systems, and architectures to concrete vendor download descriptors.
- Encode vendor priority rules (Oracle first, then fallbacks) and license metadata used by the orchestrator.
- Surface checksums when available so downstream modules can enforce integrity policies.
- Respect workspace configuration overrides that adjust vendor order or custom manifests.

## Dependencies
- [`platform-info`](./platform-info.md) types to normalize operating system and architecture identifiers.
- VS Code configuration reader to access `jaenvtix` settings for vendor prioritization or overrides.
- Internal vendor manifest tables that list download URLs, checksums, and licensing details.

## Standard error flows
- Throws when it cannot find a matching download for the requested version, OS, or architecture.
- Propagates configuration lookup errors when workspace settings are unavailable or malformed.
- Ensures LTS awareness by falling back to best-known versions; missing entries still surface as descriptive exceptions.
