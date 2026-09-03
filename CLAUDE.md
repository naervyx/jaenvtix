# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!--
  Keep this file lean: every line costs tokens on every message.
  Only document what cannot be inferred by reading the code.
  If a line answers "Claude would know this anyway", delete it.
-->

## What this is

Jaenvtix is a VS Code extension that auto-configures Java/Maven workspaces: it
parses `pom.xml` files, reuses or downloads matching JDKs, and writes per-project
`.vscode/settings.json`. It is a **provisioner that cooperates with** the official
Red Hat / Microsoft Java extensions: it feeds them settings, it never replaces them.

## Stack

- TypeScript 5.9, `strict` mode, compiled to CommonJS (`out/`)
- VS Code Extension API `^1.100`
- Tests: **Node's built-in test runner** via `tsx`, no Jest/Mocha
- Single runtime dependency: `jdk-utils` (JDK discovery)

## Commands

```bash
bun run test                                      # compile + lint + full suite (pretest hook)
node --import tsx --test test/build/vsCodeSettingsWriter.test.ts   # single test file
bun run lint                                      # eslint (flat config)
bun run compile                                   # tsc only
bun run package                                   # build the .vsix
```

README images live in `docs/images/` and are referenced with relative paths.
`vsce` rewrites those to `github.com/<repo>/raw/HEAD/...` when packaging, and
`HEAD` is the default branch, so a `.vsix` built from a feature branch shows
broken images on the extension page until the branch merges. To check them in
a local build, pass the branch explicitly:

```bash
bunx @vscode/vsce package --baseImagesUrl "https://raw.githubusercontent.com/naervyx/jaenvtix/<branch>"
```

`docs/**` is in `.vscodeignore` on purpose: the rewritten URLs are absolute, so
shipping the files inside the package would only add weight.

## Architecture

The extension is a **step pipeline**. `extension.ts` registers the
`jaenvtix.configureJava` command; `configuration/configureJavaCommand.ts`
defines the ordered step list in `getDefaultStepGroups()` (pre-confirm
validation steps, then post-confirm download/write steps under a progress UI).

- Every step implements `ConfigurationStep` (`core/types.ts`) and communicates
  through the shared mutable `JavaConfigurationState`. **Steps are
  order-dependent**: later steps read state populated by earlier ones.
- Steps return `StepResult.success() / .warning(msg) / .error(msg)`, never
  throw for expected failures. `warning` = quiet stop ("nothing to do", shown
  as a non-alarming toast); `error` = abort with an error toast.
- Adding a step: implement it in `configuration/steps/`, register it in
  `getDefaultStepGroups()`, **and** add its progress label to
  `Messages.Progress.STEPS` (keyed by the step's `name`).

Folder intent (only the non-obvious):

```
src/build/     # pure builders & writers: paths, download URLs, file contents
               # ("build" = building artifacts, not compilation)
src/search/    # pom.xml / Java source parsers (hand-rolled XML scanner)
test/          # mirrors src/ 1:1; shared fixtures in test/fixtures/
```

## Conventions

- All user-facing strings live in `util/message.ts` (`Messages`). Never inline
  notification text in steps.
- `Messages.Log` lines go through `util/logger.ts` (`log()`), never
  `console.log`; `activate()` wires the sink to the "Jaenvtix" output channel;
  the console default exists only so tests run without an extension host.
- Tests run under plain Node, with **no extension host**. Modules with logic under
  test must not import `vscode` at top level; inject dependencies via an
  optional `deps` constructor parameter (see `ValidateEnvironmentStep`,
  `ScheduleDownloadsStep` for the pattern).
- Tests use real filesystem I/O against temp dirs (`test/fixtures/tempDir.ts`)
  and local HTTP servers (`test/fixtures/http.ts`), no mocking framework.
- JSDoc on non-trivial functions documents **business rules**, not mechanics.
  Follow the existing `Business rules:` section style.

## Critical invariants

<!-- The section that matters most: rules Claude cannot infer from one file. -->

- **Merge, never overwrite.** Every writer merges non-destructively:
  user-authored entries in `settings.json`, `toolchains.xml`, and
  `java.configuration.runtimes` are preserved verbatim. The `default` flag on
  runtimes belongs to the user; never set or strip it.
- **Respect `mvnw`.** When a project ships its own Maven wrapper, leave
  `maven.executable.path` unset and skip the Jaenvtix Maven download for it.
- **Java version boundary** (`TOOLING_JAVA_MIN_VERSION = 21`): Java 21+
  projects get `java.jdt.ls.java.home`; older projects get a
  `java.configuration.runtimes` entry instead, never both.
- **Idempotency.** Every file writer does change detection and returns
  `updated: false` on no-ops so re-runs don't bump mtimes or spam logs.
- The state keys in `activation/autoConfigPrompt.ts`
  (`jaenvtix.autoConfigPromptDismissed`, `jaenvtix.autoConfigAlways`) are a
  persistence contract; renaming them re-prompts every existing user.

## Architecture constraints

- **Zero new runtime dependencies.** ZIP/TAR extraction, XML parsing, and HTTP
  downloads are hand-rolled on purpose to keep the `.vsix` lean. Do not add
  libraries for these.
- Jaenvtix only writes inside `~/.jaenvtix/`, `~/.m2/`, and each project's
  `.vscode/`; it never moves or modifies system JDK installations.
