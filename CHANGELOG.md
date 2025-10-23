# Change Log

All notable changes to the "jaenvtix" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- Toolchain manager that merges vendor/version entries into `~/.m2/toolchains.xml` while preserving existing content.
- Workspace configurator that writes `.vscode/settings.json` with `maven.executable.path`, `maven.terminal.useJavaHome`, and `jaenvtix.*` metadata, respecting project `mvnw` wrappers.
- Commands for opening `toolchains.xml`, reinstalling mvnd, and cleaning Jaenvtix caches (`~/.jaenvtix/temp`).
- Unit tests covering toolchain parsing/writing and workspace settings generation.