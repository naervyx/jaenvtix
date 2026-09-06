# Jaenvtix

[![License: EPL 2.0](https://img.shields.io/badge/license-EPL%202.0-blue?style=for-the-badge)](LICENSE.md)

**Jaenvtix — the Maven monorepo provisioner that respects your workspace.**
Multi-module, multi-root, heterogeneous `mvnw`, multi-vendor JDK — working out of the box with
explicit consent, non-destructive merges, and security-aware JDK patch updates.

Jaenvtix inspects every Maven project in your workspace, resolves the required Java version from
`pom.xml`, **reuses an already-installed JDK when possible** (otherwise downloads a matching one),
and wires each project's `.vscode/settings.json` so it is ready to build — no more manual
`JAVA_HOME` juggling when you jump between services that target different Java versions, even
inside multi-root workspaces.

Designed to **cooperate** with the official Java extensions (Red Hat / Microsoft) instead of
replacing them: Jaenvtix populates the settings those extensions read, respects each project's
`mvnw` when present, and yields ownership when the ecosystem already does the right thing.

---

## What makes Jaenvtix different

### 🤝 Cooperation & respect (philosophy)

- **Explicit consent, every workspace** — the first time Jaenvtix detects a `pom.xml` in a
  workspace, it asks. There is no silent mode and no global opt-in: nothing is written anywhere
  without an answer for the workspace in front of you.
  `Jaenvtix: Reset Auto-Configuration Preference` brings the prompt back everywhere.
- **All or nothing** — Jaenvtix installs nothing without being asked, and configures nothing it
  cannot make work. If Java language support is missing it offers to install it, and stops if that
  does not happen. No run ever reports success over a workspace where nothing works.
- **Yields to `mvnw` when present** — if your project ships `mvnw`, Jaenvtix omits
  `maven.executable.path` / `preferMavenWrapper` so `vscode-maven` uses your wrapper as intended.
- **Auto-fixes broken `java.configuration.runtimes`** — recovers paths users typed wrong (e.g.
  pointing at `bin/` instead of the JDK root) and removes orphans pointing to deleted JDKs.
  Always tries to preserve before removing.
- **Respects existing `~/.m2/toolchains.xml`** — reads JDKs you already registered there (for
  `maven-toolchains-plugin` CI builds) instead of ignoring them and downloading duplicates.

### 🏗️ Power for Maven monorepos

- **Multi-module parent inheritance of `<java.version>`** — Spring Boot monorepos with
  `<java.version>` only on the parent pom: child modules inherit transparently.
- **Per-project Maven version isolation** — a workspace with Maven 3.6 in one module and
  Maven 3.9 in another? Each gets its own download in `~/.jaenvtix/jdk-N/mvn-<version>/`.
  No conflicts.
- **Custom `jaenvtix-mvn` wrapper** — pins `JAVA_HOME`, `MAVEN_HOME`, `PATH`, and forces
  `-s ~/.m2/settings.xml -Dmaven.repo.local=~/.m2/repository`. Robust from PowerShell, CI
  shells, anywhere.
- **Non-destructive `~/.m2/toolchains.xml` generation** — merges one `<toolchain>` per JDK
  without touching what you wrote manually.

### ⚡ Java dev quality of life

- **Sensible Java tunings out of the box** — `java.debug.settings.hotCodeReplace: "auto"`
  (only when auto-build is on — it is a no-op without it), parallel builds using your cores,
  hierarchical package view, JUnit UTF-8 fix on Windows. Applied once, never overriding values
  you already set.
- **Maven favorites seeded like IntelliJ run configurations** — every project gets a
  `clean install -DskipTests` favorite in the Maven explorer; Spring Boot apps also get
  `spring-boot:run`. Seeded once (`maven.terminal.favorites`); yours to edit afterwards.
- **Hierarchical Maven view for monorepos** — multi-module workspaces get
  `maven.view: "hierarchical"` so the Maven panel mirrors the module tree, IntelliJ-style.
- **Spring Boot Tools auto-configured** — detects `vmware.vscode-spring-boot` (or the Boot dev
  pack) and points `spring-boot.ls.java.home` at a provisioned Java 21+ JDK, preventing
  "wrong JDK" language-server crashes.
- **Spring Initializr defaults that match your workspace** — when the Initializr extension is
  installed, `spring.initializr.defaultJavaVersion` is seeded with the best provisioned LTS
  (17+), so new projects start on a Java level your machine can actually build.
- **Post-configuration verification (doctor)** — after a run that actually changed something,
  Jaenvtix asks the Red Hat Language Server which Java level it *actually* resolved per project.
  A mismatch is reported as one actionable toast — **Restart Language Server** applies the new
  JDK in one click, no window reload — and re-checked on the next run until it is resolved.
  Idempotent re-runs skip the whole dance, so reopening a big workspace stays instant.
- **Choose your JDK vendor** — the `jaenvtix.preferredJdkVendor` setting supports Oracle,
  Temurin, Corretto, Liberica, Microsoft, Zulu, and Semeru, with an automatic fallback chain
  when your choice has no build for the requested version/platform.
- **Auto-supports new Java versions** — reads the Red Hat Java Language Server's supported
  versions at runtime. A new Java LTS works the day Red Hat publishes support for it — no
  Jaenvtix release needed.
- **Broader JDK discovery** — Chocolatey and Homebrew installations are scanned in addition to
  everything `jdk-utils` covers (`JAVA_HOME`, `JDK_HOME`, `PATH`, SDKMAN, jEnv, jabba, asdf,
  gradle, jbang) and the JDKs registered in `~/.m2/toolchains.xml`.

### 🔐 Security & reliability

- **Auto-updates JDK patches** — once a JDK is cached, Jaenvtix checks at most once every 24h
  whether the vendor published a newer patch (for vendors with a public metadata API: Temurin,
  Corretto, Liberica, Zulu, Semeru) and re-downloads it to pick up security fixes. JDKs
  installed outside the Jaenvtix cache are never touched. Toggle with
  `jaenvtix.autoUpdatePatches`.
- **Resilient downloads** — transient errors (timeout, 5xx, connection reset, 429) get
  exponential backoff retries (1s → 2s → 4s). Configurable via `jaenvtix.downloadMaxRetries`.
- **Native Alpine + Windows ARM** — devcontainers on Alpine Docker work natively (musl libc is
  detected and musl JDK builds are downloaded). Native Windows ARM64 (Surface Pro X,
  Copilot+ PCs) is supported too.

### 📦 Onboarding

- **`Jaenvtix: Install Recommended Extensions`** — opt-in command (never automatic): offers
  XML, Spring Boot Extension Pack, and Extension Pack for Java in a multi-select QuickPick with
  "(already installed)" markers. You choose; already-installed ones are never reinstalled.
- **Native workspace recommendations** — the same catalog is written to
  `.vscode/extensions.json` (merged, never replacing entries you added), so VS Code itself
  suggests the companions to anyone who opens the repo. Spring Boot Dashboard is recommended
  only when a Spring Boot app is actually detected.

---

## Quick Start

1. Install the extension (e.g. `code --install-extension jaenvtix-<version>.vsix`).
2. Open a workspace (single folder or multi-root) that contains one or more Maven projects.
3. Jaenvtix activates automatically on `pom.xml` and asks: **Yes / No**.
   * **Yes** — runs the configuration in this workspace.
   * **No** — does nothing, now or later, for this workspace.

   Without Java language support installed, the question changes to
   **Install and Configure / No**: Jaenvtix offers to install the Extension Pack for Java first,
   and configures only once that succeeds. Everything it writes is consumed by those extensions,
   so configuring without them would report success over a workspace where nothing works.
4. Once configured, reopening the workspace is silent. If the configuration goes missing, say
   because `.vscode` was deleted or never committed, the question comes back on the next open.
   A `No` is respected either way. `Jaenvtix: Reset Auto-Configuration Preference` clears the
   answers in every workspace and asks again from scratch.

You can also invoke `Jaenvtix: Java: Automatic Configuration` manually at any time. New to the
Java ecosystem on VS Code? `Jaenvtix: Install Recommended Extensions` sets up the companion
extensions in one step.

---

## When NOT to use Jaenvtix

Honest about what we don't cover:

- **Gradle projects** — Jaenvtix is a Maven specialist (Gradle is a possible future addition).
- **You want a JDK selector dropdown in the terminal** — Jaenvtix configures the terminal env
  per folder, not VS Code terminal profiles per JDK.
- **You want everything installed without asking** — Jaenvtix always asks before its first run
  and never auto-installs companion extensions.
- **Corporate proxy with a custom SSL certificate** — the current version has no explicit
  proxy/certificate support (it relies on Node defaults). Open an issue if this blocks you.

If any of these is critical,
[cypher256/java-extension-pack](https://github.com/cypher256/java-extension-pack) might be a
better fit.

---

## Recommended companions

Jaenvtix is a **provisioner**, not a language server. It pairs with the official Java extensions
and populates the settings each of them reads. The recommended baseline is the Microsoft
**[Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)**,
which bundles:

| Extension | What it does | What Jaenvtix feeds it |
| --- | --- | --- |
| **Language Support for Java™ by Red Hat** (`redhat.java`) | Compiler / IntelliSense / refactor via Eclipse JDT-LS | `java.configuration.runtimes`, `java.jdt.ls.java.home`, `java.configuration.maven.userSettings` |
| **Maven for Java** (`vscjava.vscode-maven`) | Maven Explorer, goal execution | `maven.executable.path` (when no `mvnw`), `maven.executable.preferMavenWrapper`, `maven.terminal.favorites`, `maven.view`, `terminal.integrated.env.*` |
| **Project Manager for Java** (`vscjava.vscode-java-dependency`) | Project tree / dependency view | `java.dependency.packagePresentation` tuning; reads the rest from Red Hat |
| **Debugger for Java**, **Test Runner for Java** | run/debug, JUnit | launch configurations, `hotCodeReplace` tuning, `java.test.config` UTF-8 fix on Windows |
| **Spring Boot Tools** (`vmware.vscode-spring-boot`) | Spring language server, live data | `spring-boot.ls.java.home` (a provisioned Java 21+ JDK) |
| **Spring Initializr** (`vscjava.vscode-spring-initializr`) | project generation from start.spring.io | `spring.initializr.defaultJavaVersion` (best provisioned LTS) |

Without the Extension Pack, the per-folder `.vscode/settings.json` Jaenvtix writes still tries to
do the right thing, but the language-server / build features only light up once the Red Hat
extension is present.

### How the pieces reinforce each other

Side effects you get for free from the cooperation model — none of them require configuration:

* **No-Config Debug just works** — the `debugjava` command that Debugger for Java adds to the
  terminal inherits the per-folder `JAVA_HOME`/`PATH` Jaenvtix injects, so it debugs with the
  project's exact JDK.
* **Spring Boot LS never complains about the JVM** — Spring Tools validates its JVM at startup
  (`spring-boot.ls.checkJVM`); because Jaenvtix hands it a valid Java 21+ home, that check stays
  green instead of greeting you with a warning dialog.
* **CVE alerts get resolved, not just reported** — Project Manager's Dependency Checkup notifies
  you when your runtime has known vulnerabilities; Jaenvtix's 24h patch auto-update is the other
  half: it refreshes cached JDKs so the alert has nothing to point at.
* **Initializr → ready-to-build in one flow** — generate a project with Spring Initializr, and
  the new `pom.xml` triggers Jaenvtix's activation: JDK resolved, Maven wired, launch config
  created, dashboard recommended. The IntelliJ "new project wizard" feel, assembled from
  official parts.
* **Spring Boot Dashboard finds runnable apps immediately** — it discovers apps through the
  language server and debugger that Jaenvtix already pointed at the right JDK, and the
  `Jaenvtix: Spring Boot (…)` launch configs give it named entries from the first click.
* **Refreshes are event-driven, then verified** — when a run changes project settings, Jaenvtix
  waits for the Red Hat server's `serverReady` signal (a short, labelled phase of the progress
  notification) before asking it to re-import the changed projects, then reads back the resolved
  Java level (doctor). If the server is still loading when the wait budget runs out, the refresh
  and verification resume automatically the moment it finishes — never on a timer, never lost.

---

## How it works

### Per Java version detected in your workspace

* **Reuses an already-installed JDK** when possible — `JAVA_HOME`, `JDK_HOME`, `PATH`, SDKMAN,
  jEnv, jabba, asdf, gradle and jbang locations are scanned (powered by the
  [`jdk-utils`](https://www.npmjs.com/package/jdk-utils) library, the same one Red Hat uses
  internally), plus Chocolatey and Homebrew installation directories, plus the JDKs registered
  in your `~/.m2/toolchains.xml`.
* **Downloads only what is missing** — following your `jaenvtix.preferredJdkVendor` (default
  `auto`: Oracle for LTS 21+, then Corretto, then Temurin, with Microsoft and Liberica as last
  resorts for platforms the primaries don't cover). Every candidate URL is probed first, so an
  unavailable vendor falls back automatically. Cached at `~/.jaenvtix/jdk-<version>/`.
* **Keeps cached JDKs patched** — at most once every 24h, Jaenvtix asks the vendor's metadata
  API whether a newer patch of a cached JDK exists and refreshes the cache slot when it does.
  Detected system JDKs are never modified.
* **Retries transient download failures** — timeouts, connection resets, 5xx and 429 responses
  are retried with exponential backoff; permanent failures (404, DNS) fail fast.
* **Downloads Maven** into `~/.jaenvtix/jdk-<version>/mvn-custom/` *only* when at least one
  project in the workspace neither ships `mvnw` nor pins its own Maven version — workspaces
  that are 100 % mvnw-driven skip this entirely.
* **Generates a Jaenvtix Maven wrapper** (`jaenvtix-mvn` on Unix / `jaenvtix-mvn.cmd` on
  Windows) inside each provisioned Maven's `bin/`. It pins `JAVA_HOME`, `MAVEN_HOME`, `PATH`,
  and forces `-s ~/.m2/settings.xml` / `-Dmaven.repo.local=~/.m2/repository` before invoking
  Maven — robust even from a plain PowerShell or CI shell where the stock `mvn.cmd` would
  resolve `JAVA_HOME` from an unpredictable environment.

### Per project (the per-folder settings Jaenvtix writes)

When a project **does NOT** ship `mvnw`:

| Setting | Value |
| --- | --- |
| `maven.executable.path` | path to the Jaenvtix wrapper of the matching JDK/Maven |
| `maven.executable.preferMavenWrapper` | `false` (so vscode-maven uses the explicit path) |
| `maven.terminal.customEnv` | per-folder `JAVA_HOME` / `MAVEN_HOME` / `M2_HOME` / `PATH` |
| `terminal.integrated.env.{windows,linux,osx}` | same env, applied to every terminal opened in the folder |
| `java.jdt.ls.java.home` *(Java 21+)* or `java.configuration.runtimes` *(Java < 21)* | the matching JDK; folder runtimes are **merged** — entries you authored (or repointed) win |
| `java.configuration.maven.userSettings` | `~/.m2/settings.xml` |
| `java.compile.nullAnalysis.mode` | `automatic` *(seeded once — change it and Jaenvtix won't touch it again)* |
| `java.configuration.updateBuildConfiguration` | `automatic` *(seeded once, same rule)* |
| `maven.terminal.favorites` | common goals (`clean install -DskipTests`, `spring-boot:run` for Spring apps) *(seeded once)* |

If any terminal-affecting setting changed and you have terminals open, Jaenvtix tells you to
reopen them — VS Code only applies the new environment to new terminals.

When a project **DOES** ship `mvnw` (Spring Boot, Quarkus, etc.), Jaenvtix yields to it:

* `maven.executable.path` is **omitted** (vscode-maven invokes the in-project `mvnw`).
* `maven.executable.preferMavenWrapper` is **omitted** (its default is already `true`).
* `maven.terminal.customEnv` is **omitted** (redundant with `terminal.integrated.env.*`).
* The other LS / Java settings remain — they help the Red Hat language server resolve types
  regardless of how the build is launched.

### Per workspace (the global / cross-workspace settings Jaenvtix writes)

* **`java.configuration.runtimes` in User Settings** — populated with one entry per JDK in the
  Jaenvtix cache, **non-destructively** (existing entries the user authored are preserved).
  Invalid entries are auto-repaired when possible (`jaenvtix.enableRuntimePathFix`) and removed
  only as a last resort.
* **Sensible Java tunings in User Settings** — `hotCodeReplace`, `maxConcurrentBuilds`,
  hierarchical package presentation, organize-imports threshold, and the JUnit UTF-8 fix on
  Windows. Each value is written only if you haven't set it yourself
  (`jaenvtix.applyJavaTunings` opts out).
* **`spring-boot.ls.java.home`** — written when Spring Boot Tools is installed and a Java 21+
  JDK is provisioned, never overwriting a value you set
  (`jaenvtix.configureOptionalExtensions` opts out).
* **`spring.initializr.defaultJavaVersion`** — seeded with the best provisioned LTS (17+) when
  the Spring Initializr extension is installed, same never-overwrite rule.
* **`.vscode/extensions.json`** — the recommended-extensions catalog is merged into the
  workspace root's recommendations (your entries and `unwantedRecommendations` untouched);
  Spring Boot Dashboard is added only when a Spring Boot app was detected.
* **`~/.m2/toolchains.xml`** — generated / merged with one `<toolchain>` per JDK, so any project
  that opts into `maven-toolchains-plugin` (CI builds, etc.) finds a matching JDK without manual
  setup. Existing toolchains the user authored are preserved — and also read back as a JDK
  discovery source.
* After writing settings, and **only for projects whose settings actually changed**, Jaenvtix
  waits for the Red Hat language server to signal readiness (`serverReady`, a labelled wait
  inside the progress notification), invokes `java.projectConfiguration.update` per changed
  `pom.xml` so the new runtime mapping is picked up without a window reload, then **verifies**
  the resolved Java level per project (skipping aggregator poms with no `src/main/java`). A
  project still compiling at the old level gets a single informational toast with a one-click
  **Restart Language Server** action — restarting is how the server applies a new
  `java.jdt.ls.java.home` — and stays flagged for re-verification on the next run until it
  resolves. If the server is still loading after the wait budget (15 s), the refresh and
  verification run automatically as soon as it becomes ready instead of reporting stale state.

### Multi-module Maven monorepos

> 🌟 **This is a Jaenvtix-exclusive feature.**

When the workspace contains a parent pom that declares `<java.version>` and modules that don't,
each module **inherits the parent's version** automatically (Spring Boot monorepo style). The
inheritance walks ancestors that are *also part of the workspace*, so importing only a single
module without its parent still falls back gracefully.

### Per-project Maven version isolation

If your workspace has projects requiring different Maven versions (e.g. a legacy module pinned
to Maven 3.6 via `<prerequisites><maven>` and a modern one declaring
`<properties><maven.version>3.9.5</maven.version>`), Jaenvtix downloads each version
independently and points each project's `.vscode/settings.json` at the right one:

```
~/.jaenvtix/jdk-21/
├── mvn-3.6.3/
│   └── bin/jaenvtix-mvn
├── mvn-3.9.5/
│   └── bin/jaenvtix-mvn
└── mvn-custom/  (default when the pom pins no Maven version)
    └── bin/jaenvtix-mvn
```

Each project's wrapper pins its own Maven, JDK, and env. No conflicts. Disable with
`jaenvtix.isolatedMavenPerProject: false` if you prefer a single shared Maven.

### Auto-activation contract

* Activation events: `workspaceContains:pom.xml` and `workspaceContains:**/pom.xml` (the
  extension stays out of memory until there is something to do). Both are declared on purpose.
  The host resolves a literal name with a direct `exists()` on each workspace root, but sends
  any glob to the search service under a 7 second cancel budget that also honours
  `files.exclude`, `search.exclude` and `.gitignore`. With only the glob, activation in a large
  or deeply nested repository is a race the extension can lose.
* The prompt is shown **at most once per extension host lifetime** even in multi-root
  workspaces with several `pom.xml` files (the activation event can fire multiple times — the
  prompt is single-shot).
* **The prompt follows the state of the project, not your answer history.** A workspace with a
  `pom.xml` and no Jaenvtix configuration gets asked, even if you answered before. Delete
  `.vscode` and the question comes back, because a past `Yes` does not configure anything today.
* `No` is the exception and it is permanent for that workspace, configured or not. That is what
  keeps the rule above from asking again on every open of a project where you deliberately keep
  `.vscode` out of the repository. `Jaenvtix: Java: Automatic Configuration` still works from the
  Command Palette if you change your mind.
* "Is it configured?" is answered from the `settings.json` files the last successful run wrote,
  one per resolved project, recorded in `workspaceState`. A single deleted file makes the whole
  workspace unconfigured, which is what covers a monorepo that lost one module. A workspace with
  no recorded list falls back to looking for a `jaenvtix.*` key in each folder root's
  `settings.json`.
* Running the configuration from the Command Palette counts as a `Yes`, so configuring by hand is
  not followed by a prompt on the next open.
* There is no global preference and no silent mode. Every workspace answers for itself.
* `Jaenvtix: Reset Auto-Configuration Preference` clears **every** workspace at once, not just the
  one in front of you. It bumps a global generation counter that every answer is stamped with, so
  older answers stop counting. Those rows stay in the host's storage because there is no API to
  reach another workspace's state, but they no longer silence anything.
* Closing the prompt with the X button does **not** persist anything — the user gets another
  chance next session. Neither does a run that fails or stops early: nothing was configured, so
  nothing is recorded.
* Known limit: a module added to an already-configured monorepo is not detected, because the
  recorded files all still exist. Run the command from the Command Palette after adding one.
  Detecting it would mean scanning for `pom.xml` on every activation, which is the cost the
  activation events above exist to avoid.
* Nothing is configured while the Red Hat Java extension (`redhat.java`) is missing. That case
  is a prompt, not a silence: the workspace is offered **Install and Configure / No**. Running
  `Jaenvtix: Java: Automatic Configuration` from the Command Palette still configures anyway, for
  anyone who wants the provisioning without the editor integration.

---

## Supported platforms

* **Windows**: x64 + ARM64 native (Surface Pro X, Copilot+ PCs)
* **macOS**: x64 (Intel) + ARM64 (Apple Silicon)
* **Linux (glibc)**: x64 + ARM64
* **Linux (musl / Alpine)**: x64 + ARM64 — devcontainers and Alpine-based Docker images, served
  by musl-native JDK builds (Temurin `alpine-linux`, Liberica)

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
│   ├── .jaenvtix-version.json         ← exact version + vendor, drives the 24h patch check
│   ├── bin/
│   │   └── java                       ← JDK launcher
│   ├── mvn-custom/                    ← absent when the workspace is 100 % mvnw-driven
│   │   └── bin/
│   │       ├── mvn                    ← stock Maven launcher
│   │       └── jaenvtix-mvn           ← Jaenvtix wrapper (enforces JAVA_HOME + -s / -Dmaven.repo.local)
│   └── mvn-3.9.5/                     ← only when a project pins Maven 3.9.5
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
| `jaenvtix.installRecommendedExtensions`     | `Jaenvtix: Install Recommended Extensions`         |

## Jaenvtix configuration settings

All settings live under the `jaenvtix.*` namespace. All have sensible defaults; nothing is
required. On first configuration Jaenvtix also seeds these keys (with their defaults) into the
workspace `.vscode/settings.json`, so you can change one inline without hunting for it — VS Code
shows the accepted values as you edit (autocomplete / hover).

| Setting | Default | What it does |
| --- | --- | --- |
| `jaenvtix.preferredJdkVendor` | `"auto"` | Preferred JDK vendor for downloads: `auto`, `oracle`, `temurin`, `corretto`, `liberica`, `microsoft`, `zulu`, `semeru`. Automatic fallback when unavailable. |
| `jaenvtix.applyJavaTunings` | `true` | Apply sensible Java tunings (hotCodeReplace, maxConcurrentBuilds, JUnit UTF-8 on Windows, …) to User Settings on first run. |
| `jaenvtix.configureOptionalExtensions` | `true` | Auto-configure detected companion extensions (Spring Boot Tools) to use the right JDK. |
| `jaenvtix.discoverFromToolchainsXml` | `true` | Read `~/.m2/toolchains.xml` as a JDK discovery source. |
| `jaenvtix.enableRuntimePathFix` | `true` | Try to recover invalid `java.configuration.runtimes` paths before removing the entry. |
| `jaenvtix.autoUpdatePatches` | `true` | Check every 24h for newer patches of Jaenvtix-cached JDKs; re-download for security fixes. |
| `jaenvtix.downloadMaxRetries` | `3` | Maximum retries for failed downloads (transient errors only; `0` disables retries). |
| `jaenvtix.isolatedMavenPerProject` | `true` | Provision an isolated Maven per version pinned in a project's pom. |

## Dependencies

Runtime:
* [`jdk-utils`](https://www.npmjs.com/package/jdk-utils) — JDK detection across `JAVA_HOME`,
  `PATH`, SDKMAN, jEnv, jabba, asdf, gradle, jbang.

Recommended at install time (the user's responsibility, not bundled):
* [Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)
  — see "Recommended companions" above, or run `Jaenvtix: Install Recommended Extensions`.

## Contributing

```bash
bun install
bun run compile    # or: bun run watch
bun run test       # 530+ unit tests
bun run lint
bun run package    # produces a .vsix for local install
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

Eclipse Public License v2.0 — see [LICENSE.md](LICENSE.md).
