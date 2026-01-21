Jaenvtix
========

[![License: EPL 2.0](https://img.shields.io/badge/license-EPL%202.0-blue?style=for-the-badge)](LICENSE.md)

Automatic Java and Maven configuration for Visual Studio Code. Jaenvtix detects Maven projects,
resolves the Java version from `pom.xml`, downloads a matching JDK and Maven distribution, extracts
them locally, and updates workspace settings so each project is ready to build.

Quick Start
============
1. Install the extension.
2. Open a workspace (single folder or multi-root) that contains Maven projects.
3. Run `Java: Automatic Configuration` from the Command Palette.
4. Confirm the prompt and follow the progress notification.
5. The extension updates each project `.vscode/settings.json` with the required Java and Maven paths.

Features
========
* Maven `pom.xml` project detection (workspace roots and immediate child folders)
* Java version resolution from Maven properties, compiler plugin, and toolchains configuration
* Automatic JDK download (Oracle for 21 and 25, Corretto or Temurin as fallback)
* Automatic Maven download and extraction
* Multi-root workspace support
* Progress notifications for each configuration step
* Workspace settings updates for Java and Maven tooling

Supported Platforms
===================
* Windows, Linux, macOS
* x64 and arm64

Project Discovery
=================
Jaenvtix looks for `pom.xml` files in each workspace folder and its immediate child folders. Each
detected project is configured independently, even in multi-root workspaces.

Settings Updated
================
The extension updates these settings in `.vscode/settings.json`:

* `java.jdt.ls.java.home` (Java 21+ projects)
* `java.configuration.runtimes` (Java 20 and below)
* `java.jdt.ls.lombokSupport.enabled`
* `java.compile.nullAnalysis.mode`
* `java.configuration.updateBuildConfiguration`
* `java.configuration.maven.userSettings`
* `maven.executable.preferMavenWrapper`
* `maven.executable.path`
* `terminal.integrated.env.windows`
* `terminal.integrated.env.linux`
* `terminal.integrated.env.osx`

Local Directories
=================
* `~/.jaenvtix/` stores downloaded and extracted JDKs and Maven installations.
* `~/.m2/settings.xml` is used as the Maven user settings file.

Available Commands
==================
* `Java: Automatic Configuration` (`jaenvtix.configureJava`)

License
========
Eclipse Public License v2.0. See [LICENSE.md](LICENSE.md) for details.
