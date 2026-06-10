# Jaenvtix

[![License: EPL 2.0](https://img.shields.io/badge/license-EPL%202.0-blue?style=for-the-badge)](LICENSE.md)

**Automatic Java and Maven configuration for Visual Studio Code and Cursor.**

Jaenvtix inspects every Maven project in your workspace, resolves the required Java version from
`pom.xml`, **reuses an already-installed JDK when possible** (otherwise downloads a matching one),
and wires each project's `.vscode/settings.json` so it is ready to build — no more manual
`JAVA_HOME` juggling when you jump between services that target different Java versions, even
inside multi-root workspaces.

Designed to **cooperate** with the official Java extensions (Red Hat / Microsoft) instead of
replacing them: Jaenvtix populates the settings those extensions read, respects each project's
`mvnw` when present, and yields ownership when the ecosystem already does the right thing.

---

## Quick Start

1. Install the extension (e.g. `code --install-extension jaenvtix-<version>.vsix`).
2. Open a workspace (single folder or multi-root) that contains one or more Maven projects.
3. Jaenvtix activates automatically on `pom.xml` and asks once: **Yes / Always / No**.
   * **Yes** — runs the configuration in this workspace.
   * **Always** — runs it now and silently in every future workspace with a `pom.xml`.
   * **No** — does nothing now and remembers it for this workspace.
4. After the first run, every subsequent open follows the choice you persisted. Use
   `Jaenvtix: Reset Auto-Configuration Preference` from the Command Palette to bring the prompt
   back.

You can also invoke `Jaenvtix: Java: Automatic Configuration` manually at any time.

---

## Recommended companions

Jaenvtix is a **provisioner**, not a language server. It pairs with the official Java extensions
and populates the settings each of them reads. The recommended baseline is the Microsoft
**[Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)**,
which bundles:

| Extension | What it does | What Jaenvtix feeds it |
| --- | --- | --- |
| **Language Support for Java™ by Red Hat** (`redhat.java`) | Compiler / IntelliSense / refactor via Eclipse JDT-LS | `java.configuration.runtimes`, `java.jdt.ls.java.home`, `java.configuration.maven.userSettings` |
| **Maven for Java** (`vscjava.vscode-maven`) | Maven Explorer, goal execution | `maven.executable.path` (when no `mvnw`), `maven.executable.preferMavenWrapper`, `terminal.integrated.env.*` |
| **Project Manager for Java** (`vscjava.vscode-java-dependency`) | Project tree / dependency view | reads what Red Hat exposes — no direct wiring needed |
| **Debugger for Java**, **Test Runner for Java** | run/debug, JUnit | reads from Red Hat — no direct wiring needed |

Without the Extension Pack, the per-folder `.vscode/settings.json` Jaenvtix writes still tries to
do the right thing, but the language-server / build features only light up once the Red Hat
extension is present.

---

## How it works

### Per Java version detected in your workspace

* **Reuses an already-installed JDK** when possible — `JAVA_HOME`, `JDK_HOME`, `PATH`, SDKMAN,
  jEnv, jabba, asdf, gradle and jbang locations are scanned (powered by the
  [`jdk-utils`](https://www.npmjs.com/package/jdk-utils) library, the same one Red Hat uses
  internally).
* **Downloads only what is missing** — Oracle for Java 21+, Corretto / Temurin as fallback,
  cached at `~/.jaenvtix/jdk-<version>/`.
* **Downloads Maven** into `~/.jaenvtix/jdk-<version>/mvn-custom/` *only* when at least one
  project in the workspace does NOT ship `mvnw` — workspaces that are 100 % mvnw-driven skip
  this entirely.
* **Generates a Jaenvtix Maven wrapper** (`jaenvtix-mvn` on Unix / `jaenvtix-mvn.cmd` on
  Windows) inside `mvn-custom/bin/`. It pins `JAVA_HOME`, `MAVEN_HOME`, `PATH`, and forces
  `-s ~/.m2/settings.xml` / `-Dmaven.repo.local=~/.m2/repository` before invoking Maven —
  robust even from a plain PowerShell or CI shell where the stock `mvn.cmd` would resolve
  `JAVA_HOME` from an unpredictable environment.

### Per project (the per-folder settings Jaenvtix writes)

When a project **does NOT** ship `mvnw`:

| Setting | Value |
| --- | --- |
| `maven.executable.path` | path to the Jaenvtix wrapper of the matching JDK |
| `maven.executable.preferMavenWrapper` | `false` (so vscode-maven uses the explicit path) |
| `maven.terminal.customEnv` | per-folder `JAVA_HOME` / `MAVEN_HOME` / `M2_HOME` / `PATH` |
| `terminal.integrated.env.{windows,linux,osx}` | same env, applied to every terminal opened in the folder |
| `java.jdt.ls.java.home` *(Java 21+)* or `java.configuration.runtimes` *(Java < 21)* | the matching JDK |
| `java.configuration.maven.userSettings` | `~/.m2/settings.xml` |
| `java.jdt.ls.lombokSupport.enabled` | `true` |
| `java.compile.nullAnalysis.mode` | `automatic` |
| `java.configuration.updateBuildConfiguration` | `automatic` |

When a project **DOES** ship `mvnw` (Spring Boot, Quarkus, etc.), Jaenvtix yields to it:

* `maven.executable.path` is **omitted** (vscode-maven invokes the in-project `mvnw`).
* `maven.executable.preferMavenWrapper` is **omitted** (its default is already `true`).
* `maven.terminal.customEnv` is **omitted** (redundant with `terminal.integrated.env.*`).
* The other LS / Java settings remain — they help the Red Hat language server resolve types
  regardless of how the build is launched.

### Per workspace (the global / cross-workspace settings Jaenvtix writes)

* **`java.configuration.runtimes` in User Settings** — populated with one entry per JDK in the
  Jaenvtix cache, **non-destructively** (existing entries the user authored are preserved). This
  lets the Red Hat language server resolve every project's runtime automatically, even outside
  this specific workspace.
* **`~/.m2/toolchains.xml`** — generated / merged with one `<toolchain>` per JDK, so any project
  that opts into `maven-toolchains-plugin` (CI builds, etc.) finds a matching JDK without manual
  setup. Existing toolchains the user authored are preserved.
* After writing settings, Jaenvtix invokes `java.projectConfiguration.update` per `pom.xml` so
  the Red Hat language server picks up the new runtime mapping without a window reload.

### Multi-module Maven monorepos

When the workspace contains a parent pom that declares `<java.version>` and modules that don't,
each module **inherits the parent's version** automatically (Spring Boot monorepo style). The
inheritance walks ancestors that are *also part of the workspace*, so importing only a single
module without its parent still falls back gracefully.

### Auto-activation contract

* Activation event: `workspaceContains:**/pom.xml` (the extension stays out of memory until
  there is something to do).
* The prompt is shown **at most once per extension host lifetime** even in multi-root
  workspaces with several `pom.xml` files (the activation event can fire multiple times — the
  prompt is single-shot).
* `Yes` / `No` answers are remembered per workspace (`workspaceState`).
* `Always` is remembered globally (`globalState`) and overrides any prior per-workspace `No`.
* Closing the prompt with the X button does **not** persist anything — the user gets another
  chance next session.
* `Jaenvtix: Reset Auto-Configuration Preference` clears both layers.

---

## Supported platforms

* Windows, Linux, macOS
* x64, arm64

## Project discovery

Jaenvtix looks for `pom.xml` files in each workspace folder and its immediate child folders.
Each detected project is configured independently. Modules inside a multi-module monorepo also
benefit from version inheritance (see above).

## Local layout

File names below use the Unix convention; on Windows the binaries gain `.exe` / `.cmd`
suffixes automatically.

```
~/.jaenvtix/
├── jdk-17/                            ← downloaded only if no installed JDK 17 was reused
│   ├── bin/
│   │   └── java                       ← JDK launcher
│   └── mvn-custom/                    ← absent when the workspace is 100 % mvnw-driven
│       └── bin/
│           ├── mvn                    ← stock Maven launcher
│           └── jaenvtix-mvn           ← Jaenvtix wrapper (enforces JAVA_HOME + -s / -Dmaven.repo.local)
├── jdk-21/ ...
└── temp/                              ← download staging; cleared after extraction

~/.m2/
└── toolchains.xml                     ← merged non-destructively with one <toolchain> per JDK
```

## Available commands

| Command ID                                  | Title                                              |
| ------------------------------------------- | -------------------------------------------------- |
| `jaenvtix.configureJava`                    | `Jaenvtix: Java: Automatic Configuration`          |
| `jaenvtix.resetAutoConfigPreference`        | `Jaenvtix: Reset Auto-Configuration Preference`    |

## Settings written by Jaenvtix

Jaenvtix **does not contribute its own configuration namespace** (no `jaenvtix.*` settings).
Every value it persists lives under the namespaces of the official extensions (`maven.*`,
`java.*`, `terminal.integrated.env.*`) — see the table above. Auto-activation preferences live
in VS Code's `workspaceState` / `globalState`, not in `settings.json`.

## Dependencies

Runtime:
* [`jdk-utils`](https://www.npmjs.com/package/jdk-utils) — JDK detection across `JAVA_HOME`,
  `PATH`, SDKMAN, jEnv, jabba, asdf, gradle, jbang.

Recommended at install time (the user's responsibility, not bundled):
* [Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)
  — see "Recommended companions" above.

## Contributing

```bash
bun install
bun run compile    # or: bun run watch
bun run test       # 250+ unit tests
bun run lint
bun run package    # produces a .vsix for local install
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

Eclipse Public License v2.0 — see [LICENSE.md](LICENSE.md).
