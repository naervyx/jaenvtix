# Platform Info Limitations

1. **Alias coverage is finite.** Only the known set of operating system and architecture aliases are normalized; uncommon identifiers fall back to `"unknown"`.
2. **Override validation is minimal.** User-provided overrides from `jaenvtix.platform.override` are not cross-checked against supported combinations.
3. **No environment probing.** The module defers entirely to Node.js runtime data and overrides; it does not inspect container metadata or virtualization hints.
4. **Static architecture taxonomy.** Emerging architectures require code changes before they can be recognized and normalized.
