# Platform Info

## Responsibilities
- Normalize the host operating system and architecture values into a canonical set consumed by downstream modules.
- Apply workspace configuration overrides so users can emulate other platforms when necessary.
- Provide lightweight helpers that other modules can call synchronously during initialization.

## Dependencies
- Node.js `os` module for runtime platform and architecture detection.
- VS Code configuration reader to load `jaenvtix.platform.override` settings.
- Alias maps that translate platform and architecture synonyms into normalized identifiers.

## Standard error flows
- Defaults to `unknown` for any platform or architecture that cannot be matched against the supported aliases.
- Ignores empty or whitespace-only configuration overrides, preventing accidental resets to invalid values.
- Relies on configuration access errors propagating to callers to aid debugging when VS Code APIs fail.
