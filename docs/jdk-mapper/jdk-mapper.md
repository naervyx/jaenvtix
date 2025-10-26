# JDK Distribution Mapper

## Overview

The `jdkMapper` module translates requested Java versions and workspace policies into concrete distribution descriptors. It selects vendors, download URLs, archive formats, and checksum expectations so the downloader knows exactly which artifact to retrieve.

## Responsibilities

- Interpret workspace preferences (Oracle first, fallback vendor, preview allowance) and map them to manifest entries.
- Provide deterministic resolution results including version metadata, archive filenames, checksum algorithms, and licensing notes.
- Expose helper utilities to list supported vendors and versions for UI presentation.
- Guard against unsupported combinations by surfacing actionable errors for the orchestrator.

## Dependencies

- **Embedded distribution manifests** — JSON catalogues stored under `vendor/manifests` describing available JDK builds.
- **Platform info module** — informs architecture-specific selection logic.
- **Configuration bridge** — reads user settings that toggle preview versions or vendor priorities.

## Standard Error Flows

- **Unsupported version/vendor**: throws `NoMatchingDistributionError` listing the requested parameters and suggesting available alternatives.
- **Preview not allowed**: emits `PreviewJdkRejectedError` when the requested version is marked as preview and the workspace disallows it.
- **Manifest corruption**: raises `ManifestIntegrityError` if the embedded catalogue lacks required fields or fails JSON schema validation.

## API

### `resolveDistribution(request: DistributionRequest): DistributionDescriptor`

- **Input**: `{ version, os, arch, preferOracle, fallbackVendor, allowPreview }` describing the provisioning intent.
- **Output**: descriptor containing vendor identifier, download URL, checksum (value + algorithm), archive format, and metadata required by downstream modules.
- **Behaviour**:
  - Normalises version numbers (`1.8` → `8`) before lookup.
  - Attempts Oracle first when allowed, then falls back through the configured vendor priority list.
  - Applies architecture filters to ensure the selected binary matches the host.

### `listSupportedDistributions(): DistributionCatalogue`

- Returns a snapshot of all vendors, versions, and platforms embedded in the manifest so UI components can display availability.

## Integration Guidelines

- Always call `resolveDistribution` before initiating downloads to ensure checksum metadata is available.
- Cache descriptors per version/vendor in the orchestrator to avoid repeated manifest parsing during a run.
- Surface `NoMatchingDistributionError` details directly to users—they usually contain remediation steps (e.g., enabling preview support).
