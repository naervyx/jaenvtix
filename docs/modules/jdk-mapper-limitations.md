# JDK Distribution Mapper Limitations

1. **Manifest coverage is curated manually.** Only LTS releases (8, 11, 17, 21, 25) and a handful of vendors are embedded; adding new vendors or versions requires code changes and manifest updates.
2. **Preview handling is coarse.** Preview releases are rejected unless `jaenvtix.allowPreviewJdk` is set, and even then rely on available manifest entries.
3. **Network retrieval is out of scope.** The mapper resolves metadata only; it does not download artifacts or verify accessibility of vendor URLs.
4. **Checksum policies are static.** Vendor manifests define checksum algorithms up front, so new hashing schemes need explicit support before they can be consumed.
