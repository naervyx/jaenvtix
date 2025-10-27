# JDK Distribution Mapper

The JDK distribution mapper centralizes how the extension chooses a download artifact for a
requested Java version, operating system, and CPU architecture. It provides a thin abstraction
over a set of curated vendor manifests so the rest of the extension can request "the best"
distribution without replicating vendor-specific logic.

## Responsibilities

- Parse the requested Java version and enforce the preview policy controlled by the
  `jaenvtix.allowPreviewJdk` setting.
- Determine the vendor selection order based on `jaenvtix.preferOracle` and
  `jaenvtix.fallbackVendor`.
- Resolve the `url`, `checksum`, and license metadata for the selected distribution.
- Surface errors when no compatible artifact exists for the requested platform.

## Vendor Priority

`resolveJdkDistribution` determines the vendor preference list using the following rules:

1. Oracle is tried first when `jaenvtix.preferOracle` is enabled (default).
2. Amazon Corretto and Eclipse Temurin are used as LTS OpenJDK fallbacks.
3. The configured `jaenvtix.fallbackVendor` value is always attempted last if it did not already
   appear earlier in the ordered list.

The mapper ships with manifests for the LTS releases (8, 11, 17, 21, 25) we support today. Each
manifest enumerates the supported operating system and architecture combinations so that resolution
fails fast when a platform is unavailable.

## Extending Support

Adding a new vendor or version involves updating the manifest map in
`src/modules/jdkMapper/index.ts`. Whenever a new vendor is introduced, ensure the README lists the
supported fallback values so users can configure them explicitly.
