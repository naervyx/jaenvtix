# Changelog

All notable changes to this extension are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - Unreleased

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
