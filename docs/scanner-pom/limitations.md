# Workspace Scanner Limitations

1. **Property indirection is not resolved.** The parser reads literal values only and does not expand `${property}` references beyond the hard-coded compiler properties.
2. **Maven profiles are ignored.** Profile-specific compiler settings are skipped, so the detected Java version may not match builds that rely on profile activation.
3. **Ignored directory list is static.** Folders such as `.git`, `node_modules`, and `target` are excluded by default with no configuration surface.
4. **No metadata enrichment.** The scanner returns only file paths and Java versions; Maven coordinates like `groupId` and `artifactId` are not surfaced yet.
