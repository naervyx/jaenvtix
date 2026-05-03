# Changelog

All notable changes to this extension are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2026-05-01

### Added
- Added automatic activation for workspaces containing `pom.xml`.
- Added a single-shot auto-configuration prompt with workspace and global persistence:
  - `Yes` configures only the current workspace.
  - `Always` enables silent auto-configuration globally.
  - `No` disables auto-configuration for the current workspace.
  - Closing the prompt keeps the decision pending for the next session.
- Added `jaenvtix.resetAutoConfigPreference` command to clear workspace and global
  auto-configuration decisions.
- Added non-destructive User-level `java.configuration.runtimes` updates.
- Added non-destructive `~/.m2/toolchains.xml` generation, with one toolchain per cached JDK.
- Added installed-JDK discovery through `jdk-utils`, including support for common sources such as:
  - `JAVA_HOME`
  - `JDK_HOME`
  - `PATH`
  - SDKMAN
  - jEnv
  - jabba
  - asdf
  - Gradle
  - JBang
- Added support for refreshing Java project configuration via
  `java.projectConfiguration.update` after settings are written.
- Added support for multi-module Maven workspaces where child modules inherit
  `<java.version>` from the closest workspace parent `pom.xml`.
- Added `jdk-utils` to the packaged VSIX dependencies so runtime resolution works after install.

### Changed
- Repositioned Jaenvtix as a provisioner for the official Java/Maven VS Code ecosystem instead
  of competing with it.
- Jaenvtix now writes values into the settings namespaces consumed by the official extensions:
  - Red Hat Java extension
  - Microsoft Maven extension
  - Project Manager for Java
- When a project contains `mvnw`, Jaenvtix now respects it and avoids overriding Maven execution
  with its own wrapper configuration.
- Maven download is skipped when all detected Maven projects are already covered by `mvnw`.
- Workspace-scoped Java runtime settings no longer mask User-level runtime writes.
- The extension became less invasive in Spring Boot, Quarkus and other projects that already
  rely on Maven Wrapper behavior.

### Fixed
- Fixed activation/runtime packaging issues caused by missing `jdk-utils` in the VSIX.

### Tests
- Expanded the test suite to cover:
  - User runtime merging.
  - Toolchains XML generation.
  - JDK detection.
  - Java project refresh behavior.
  - Auto-configuration prompt decision logic.
  - Multi-module Java version inheritance.
  - Maven Wrapper versus Jaenvtix wrapper behavior.

## [0.0.4] - 2026-04-25

### Fixed
- Restored the truncated `Publish GitHub Release` step in the release workflow.
- Fixed an invalid GitHub Actions workflow caused by a missing `run` body.
- Added an explicit GitHub release title such as `Jaenvtix 0.0.4`.

### Changed
- Improved GitHub Release publishing logic to:
  - Create the release if missing.
  - Attach VSIX assets when possible.
  - Skip safely when an asset already exists.
  - Fail loudly on immutable published releases.

### CI
- Added validation to ensure workflow steps contain either `run` or `uses`.

## [0.0.3] - 2026-04-25

### Changed
- Updated the release workflow to use newer GitHub Actions versions.
- Pinned release workflow Node.js execution to Node 22.
- Added `node_modules` caching based on `package-lock.json`.
- Optimized install commands with:
  - `npm ci --prefer-offline --no-audit --no-fund`

### Fixed
- Fixed GitHub Release publishing failures when rerunning workflows against an existing release.
- Replaced release publishing behavior that could fail on immutable GitHub releases.
- Made Open VSX publishing idempotent by checking whether the version already exists before
  publishing.
- Improved workflow behavior for reruns, partial failures and already-published versions.

### CI
- Improved release workflow resilience for repeated runs on the same `release/X.Y.Z` tag.
- Added metadata extraction for publisher, extension name, version and VSIX artifact.

## [0.0.2] - 2026-04-25

### Added
- Added CI workflow for pull requests targeting `develop`.
- Added cross-OS permissions test matrix for Linux, macOS and Windows.
- Added extensive unit test coverage for orchestration, configuration steps, networking,
  file search and build helpers.
- Added `stepRunner` to host reusable configuration step execution logic.
- Added dedicated tests for:
  - Configuration step runner.
  - Environment validation.
  - Project resolution.
  - Download scheduling.
  - Project context building.
  - Maven wrapper writing.
  - VS Code settings generation.
  - Launch configuration generation.
  - Maven URL resolution.
  - URL validation.
  - File search behavior.

### Changed
- Refactored configuration orchestration for testability.
- Reduced direct VS Code API coupling in several configuration steps.
- Allowed selected build/network helpers to receive dependency overrides for hermetic tests.
- Updated test execution to run through Node's native test runner with `tsx`.

### Fixed
- Fixed download redirect handling to avoid unresolved promises on recursive redirect failures.
- Fixed download target directory creation before writing files.
- Fixed Windows Maven wrapper script path generation.
- Fixed recursive executable permission handling under `bin/`.
- Fixed malformed `launch.json` handling by allowing callers to surface a warning.
- Fixed JDK extraction failures on Linux/macOS for Corretto JDK 11/17 archives containing PAX
  global headers.
- Fixed platform-aware VS Code settings path generation.

### Security
- Improved archive extraction behavior by ignoring TAR metadata records that should not affect
  root directory detection.
- Preserved zip-slip/path traversal protection coverage through tests.

### CI
- Added pull request CI with:
  - Linting.
  - Type checking.
  - Unit tests.
  - Compilation.
  - Cross-platform filesystem permission checks.
- Added concurrency cancellation for outdated PR runs.
- Updated CI to use Node 22 and newer GitHub Actions versions.
- Added dependency caching for faster CI runs.

### Tests
- Added SDD-style regression and behavior tests covering:
  - TAR/GZip extraction.
  - ZIP extraction.
  - Maven wrapper script generation.
  - VS Code settings generation.
  - Launch configuration generation.
  - Java URL building.
  - Java version detection.
  - Java launch info detection.
  - Platform/system utilities.
  - URL validation.
  - Download behavior.

## [0.0.1] - 2026-04-22

### Added
- Automatic discovery of Maven projects across single-folder and multi-root workspaces.
- Java version resolution from `pom.xml` (properties, `maven-compiler-plugin`, toolchains).
- JDK download and extraction to `~/.jaenvtix/jdk-<version>/` (Oracle for 21+, Corretto /
  Temurin fallback).
- Maven download and extraction to `~/.jaenvtix/jdk-<version>/mvn-custom/`.
- **Jaenvtix Maven wrapper script** (`jaenvtix-mvn` / `jaenvtix-mvn.cmd`) generated per JDK,
  enforcing `JAVA_HOME`, `MAVEN_HOME`, `-s settings.xml`, and `-Dmaven.repo.local=<repo>`
  (JetBrains-style invocation).
- Per-project `.vscode/settings.json` wiring: `java.jdt.ls.java.home` /
  `java.configuration.runtimes`, `maven.executable.path` → wrapper,
  `java.configuration.maven.userSettings`, terminal env vars, Lombok support, build
  configuration, null analysis.
- Per-project `.vscode/launch.json` entry when a `main` class or Spring Boot entry point is
  detected.

### Security
- Hardened archive extraction against path traversal (zip-slip) — entries resolving outside
  the target directory are skipped.
- Temporary download archives are now removed after successful extraction.
- `decompressGzip` cleans up its read / gunzip streams even on error.

### Linux / macOS
- `tar.gz` extraction now preserves the file mode bits from the archive, so extracted `java`,
  `javac`, `mvn`, and friends keep their executable permission on Unix.
- After extracting each JDK and Maven distribution on Linux / macOS, Jaenvtix sets `0o755`
  on every file under `bin/` as a defensive fallback.
- The generated `jaenvtix-mvn` wrapper now uses a portable `/usr/bin/env sh` shebang.
