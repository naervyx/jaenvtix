# Jaenvtix

[![License: EPL 2.0](https://img.shields.io/badge/license-EPL%202.0-blue?style=for-the-badge)](LICENSE.md)

**Automatic Java and Maven configuration for Visual Studio Code and Cursor.**

Jaenvtix inspects every Maven project in your workspace, resolves the required Java version from
`pom.xml`, downloads a matching JDK and Maven distribution, and wires each project's
`.vscode/settings.json` so it is ready to build — no more manual `JAVA_HOME` juggling when you
jump between services that target different Java versions.

## Quick Start

1. Install the extension.
2. Open a workspace (single folder or multi-root) that contains one or more Maven projects.
3. Run **`Jaenvtix: Java: Automatic Configuration`** from the Command Palette (`Ctrl+Shift+P`).
4. Confirm the prompt and watch the progress notification.
5. Reload VS Code / Cursor when prompted by the Java extension — you can now build and run.

## What it does

Per Java version detected across your workspace:

* Downloads the matching JDK (Oracle for 21+, Corretto / Temurin as fallback) into
  `~/.jaenvtix/jdk-<version>/`.
* Downloads the latest Maven distribution into
  `~/.jaenvtix/jdk-<version>/mvn-custom/`.
* Generates a **Jaenvtix Maven wrapper script** inside
  `~/.jaenvtix/jdk-<version>/mvn-custom/bin/` (named `jaenvtix-mvn` on Linux / macOS and
  `jaenvtix-mvn.cmd` on Windows). The wrapper:
  * exports `JAVA_HOME`, `MAVEN_HOME`, `M2_HOME` for the right JDK,
  * prepends the correct `java` and `mvn` to `PATH`,
  * forces `-s ~/.m2/settings.xml` and `-Dmaven.repo.local=~/.m2/repository` (JetBrains-style),
  * forwards any additional arguments you pass.

  This means every Maven invocation from the Java/Maven extensions (or from a task pointed at the
  wrapper) runs with a known, reproducible toolchain — even across multi-root workspaces that
  mix Java versions.

Per project:

* Writes `.vscode/settings.json` with:
  * `java.jdt.ls.java.home` (Java 21+) or `java.configuration.runtimes` (Java 20 and below)
  * `maven.executable.path` → the Jaenvtix wrapper
  * `maven.executable.preferMavenWrapper: false`
  * `java.configuration.maven.userSettings`
  * `java.jdt.ls.lombokSupport.enabled`
  * `java.compile.nullAnalysis.mode`
  * `java.configuration.updateBuildConfiguration`
  * `terminal.integrated.env.{windows,linux,osx}` (JAVA_HOME / MAVEN_HOME / PATH)
* Writes a `.vscode/launch.json` entry if a `main` class or Spring Boot entry point is detected.

## Supported platforms

* Windows, Linux, macOS
* x64, arm64

## Project discovery

Jaenvtix looks for `pom.xml` files in each workspace folder and its immediate child folders.
Each detected project is configured independently.

## Local layout

File names below use the Unix convention; on Windows the binaries gain `.exe` / `.cmd`
suffixes automatically.

```
~/.jaenvtix/
├── jdk-17/
│   ├── bin/
│   │   └── java                ← JDK launcher
│   └── mvn-custom/
│       └── bin/
│           ├── mvn             ← stock Maven launcher
│           └── jaenvtix-mvn    ← generated wrapper (enforces JAVA_HOME + -s / -Dmaven.repo.local)
├── jdk-21/ ...
└── temp/                       ← download staging; cleared after extraction
```

## Available commands

| Command ID                 | Title                                      |
| -------------------------- | ------------------------------------------ |
| `jaenvtix.configureJava`   | `Jaenvtix: Java: Automatic Configuration`  |

## Contributing

```bash
npm install
npm run compile    # or: npm run watch
npm run package    # produces a .vsix for local install
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

Eclipse Public License v2.0 — see [LICENSE.md](LICENSE.md).
