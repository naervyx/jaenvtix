# Changelog

All notable changes to this extension are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.9] - 2026-08-30

Compatibility release: everything here is about cooperating better with the official
Red Hat / Microsoft Java extensions. No new `jaenvtix.*` settings or commands.

### Added
- Post-configuration verification ("doctor"). After a run that changed project settings,
  Jaenvtix waits for the Red Hat Language Server to signal `serverReady` (a labelled phase
  inside the progress notification), asks it to re-import only the changed projects, then
  reads back the Java level it actually resolved. A project still compiling at the old level
  gets one informational toast naming the folder, with **Restart Language Server** and
  **Show Logs** actions, and stays flagged for re-verification on the next run until it
  resolves (N1).
- One-click Language Server restart when a run changes `java.jdt.ls.java.home`. Restarting is
  how the Red Hat server picks up a new JDK, and it applies without a window reload. Always
  offered as a button, never triggered automatically (N1).
- Deferred continuation. If the server is still loading when the 15s wait budget runs out, the
  pipeline finishes anyway and the refresh and verification resume on their own the moment the
  server becomes ready, never on a timer (N1).
- `.vscode/extensions.json` recommendations at each workspace root, so VS Code itself suggests
  the companion extensions to anyone who opens the repo. Merged non-destructively: your entries
  and `unwantedRecommendations` are preserved. Spring Boot Dashboard is added only when a Spring
  Boot application was detected (P1.4, P3.10).
- `maven.terminal.favorites` seeded per project: `clean install -DskipTests` everywhere, plus
  `spring-boot:run` for Spring Boot apps. Aliases are prefixed `Jaenvtix:`, and the key becomes
  yours once it exists (N2).
- `maven.view: "hierarchical"` seeded for multi-module workspaces so the Maven panel mirrors the
  module tree (N3).
- `spring.initializr.defaultJavaVersion` seeded with the highest provisioned LTS (17 or newer)
  when the Spring Initializr extension is installed (P3.9).
- A toast asking you to reopen existing terminals when a run changed the terminal environment,
  since VS Code only applies `JAVA_HOME` / `PATH` changes to new terminals (P1.5).
- Upstream schema watch. `scripts/check-upstream-schemas.mjs` diffs the settings and commands
  Jaenvtix writes against the published manifests of the eight base extensions, a weekly
  workflow opens or refreshes an issue when they drift, and a contract test fails the suite when
  a key we write is missing from the snapshot (P4.12, P4.13).

### Changed
- Refresh and verification now touch only the projects whose settings actually changed in the
  run, plus any project the previous run flagged with a mismatch (`jaenvtix.lastVerificationMismatch`
  in workspace state). Idempotent re-runs skip the wait and both steps, so reopening a large
  workspace stays instant (N1).
- Calls into the Language Server run through a concurrency pool of 4 instead of sequential
  round-trips (N1).
- The doctor skips aggregator projects with no `src/main/java`, removing a structural false
  positive on `packaging: pom` modules (N1).
- `java.compile.nullAnalysis.mode` and `java.configuration.updateBuildConfiguration` are seeded
  only when absent, and never forced back afterwards (P2.6).
- Folder-level `java.configuration.runtimes` is merged instead of replaced. Same-name entries
  pointing at a real JDK are respected, broken paths are repaired in place while preserving
  `sources`, `javadoc` and `default`, other names are kept verbatim, and an appended entry never
  claims the `default` flag when another entry already carries it. The key is removed only when
  it holds the single Jaenvtix-provisioned entry (P2.6).
- The `java.debug.settings.hotCodeReplace: "auto"` tuning is applied only when
  `java.autobuild.enabled` is on, because auto hot code replace does nothing without it (P2.7).
- Jaenvtix no longer writes `java.jdt.ls.lombokSupport.enabled` (it matches the upstream
  default) and cleans up the redundant `true` left by older runs. A user-set `false` is kept
  (P2.8).
- The seeded JUnit UTF-8 test configuration is now named "Jaenvtix UTF-8" so it stays
  identifiable next to your own entries. `java.test.defaultConfig` is still untouched (P1.3).
- The Spring Boot Language Server JDK floor is its own constant instead of reusing the jdt.ls
  one, since the two servers raise their requirements independently (P3.11).

### Fixed
- User tunings were silently skipped whenever the Java extension pack was installed.
  `ApplyUserTuningsStep` used `get()` to decide "the user never set this", but `get()` returns
  the registered default from the installed extensions, so every tuning looked as if it were
  already set. It now uses `inspect()` (P2).

### Internal
- README documents how Jaenvtix cooperates with each base extension, what it writes for each of
  them, and how the pieces reinforce each other (N5).
- Upstream schema snapshot refreshed: additive drift only (new upstream keys), no writer
  changes (#78).

## [0.0.8] - 2026-06-27

### Added
- Spring Boot Tools auto-configuration: `spring-boot.ls.java.home` is pointed at a provisioned
  Java 21+ JDK when `vmware.vscode-spring-boot` (or the Boot dev pack) is installed (MP-15).
- `Jaenvtix: Install Recommended Extensions`, an opt-in Command Palette command that offers XML,
  Spring Boot Extension Pack, and Extension Pack for Java in a multi-select QuickPick (MP-08).
- `~/.m2/toolchains.xml` is now also **read** as a JDK discovery source; entries registered for
  `maven-toolchains-plugin` are validated and reused instead of re-downloaded (MP-04).
- Supported Java versions are read from the Red Hat Language Server's own `package.json` at
  runtime, so new LTS releases are recognized without a Jaenvtix release (MP-16).
- JDKs installed via Chocolatey (Windows) and Homebrew (macOS / Linuxbrew) are detected (MP-01).
- New JDK vendors selectable through the new `jaenvtix.preferredJdkVendor` setting: Microsoft,
  Liberica (BellSoft), Zulu (Azul), and Semeru (IBM), with automatic fallback chains (MP-02).
- Security patch auto-update: cached JDKs are checked against the vendor's metadata API at most
  once every 24h and refreshed when a newer patch ships (`jaenvtix.autoUpdatePatches`) (MP-17).
- Downloads retry transient failures (timeout, reset, 5xx, 429) with exponential backoff
  (`jaenvtix.downloadMaxRetries`) (MP-05).
- Per-project Maven version isolation: poms pinning a Maven version via
  `<prerequisites><maven>` or `<properties><maven.version>` get their own
  `~/.jaenvtix/jdk-N/mvn-<version>/` slot and wrapper (`jaenvtix.isolatedMavenPerProject`) (MP-03).
- Platform matrix extended to Linux musl (Alpine devcontainers) and native Windows ARM64 (MP-11).

- The `jaenvtix.*` settings are seeded with their defaults into the workspace
  `.vscode/settings.json` on first configuration so they are discoverable and editable inline;
  their accepted values are documented natively via `enumDescriptions` (settings.json autocomplete).

### Changed
- README repositioned around the provisioner's differentiators; documents every
  `jaenvtix.*` setting and the new platform matrix (MP-09).

## [0.0.7] - 2026-06-14

### Fixed
- macOS JDK provisioning, which could fail to install or repeatedly re-download a JDK:
  - JDKs in the macOS bundle layout (`Contents/Home`) were not recognized as installed,
    causing a re-download/re-extraction on every run and a spurious "JDK extraction
    failed" error. Installation detection and every downstream path (settings,
    `toolchains.xml`, wrapper scripts) now resolve to `Contents/Home`.
  - `EACCES: permission denied` when re-extracting a JDK over the read-only `legal/**`
    files left by a previous extraction; those files are now made writable before
    being overwritten.
  - Oracle JDK 21 and 25 macOS archives, whose entries are prefixed with `./`, extracted
    one directory too deep and failed; common-root detection now strips the `./` prefix
    so the JDK flattens correctly.

### Internal
- Migrated package management from npm to Bun.

## [0.0.6] - 2026-06-10

### Added
- Added a "Jaenvtix" output channel: configuration progress and file-write logs are
  now visible in View → Output instead of being buried in the developer console.

### Changed
- The Maven download page is now fetched with an asynchronous HTTP client instead of
  a blocking `curl` subprocess; the editor no longer freezes (up to 15s) during
  activation, and `curl` is no longer required on the system.
- Archive extraction no longer loads whole archives into memory: ZIP entries are read
  on demand via positioned file reads and `.tar.gz` archives are processed in two
  streaming passes, sharply reducing the memory peak when installing large JDKs.

### Internal
- Audit-driven, behavior-preserving refactor: shared XML scanner for the `pom.xml`
  parsers, centralized `JavaRuntime` type, `settingTag.ts` renamed to
  `vsCodeSettingsWriter.ts` with its writer decomposed into named sections, the last
  `eslint-disable` removed via dependency injection, stricter TypeScript checks
  (`noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
  `noUnusedParameters`), and repo-wide formatting enforced by new `@stylistic` rules.

### Tests
- Suite grew to 285 tests with new coverage for the asynchronous HTTP text fetcher
  (redirects, timeouts, error statuses).

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
- Hardened archive extraction against path traversal (zip-slip); entries resolving outside
  the target directory are skipped.
- Temporary download archives are now removed after successful extraction.
- `decompressGzip` cleans up its read / gunzip streams even on error.

### Linux / macOS
- `tar.gz` extraction now preserves the file mode bits from the archive, so extracted `java`,
  `javac`, `mvn`, and friends keep their executable permission on Unix.
- After extracting each JDK and Maven distribution on Linux / macOS, Jaenvtix sets `0o755`
  on every file under `bin/` as a defensive fallback.
- The generated `jaenvtix-mvn` wrapper now uses a portable `/usr/bin/env sh` shebang.
