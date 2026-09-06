# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!--
  Keep this file lean: every line costs tokens on every message.
  Only document what cannot be inferred by reading the code.
  If a line answers "Claude would know this anyway" — delete it.
-->

## What this is

Jaenvtix is a VS Code extension that auto-configures Java/Maven workspaces: it
parses `pom.xml` files, reuses or downloads matching JDKs, and writes per-project
`.vscode/settings.json`. It is a **provisioner that cooperates with** the official
Red Hat / Microsoft Java extensions — it feeds them settings, it never replaces them.

## Stack

- TypeScript 5.9, `strict` mode, compiled to CommonJS (`out/`)
- VS Code Extension API `^1.100`
- Tests: **Node's built-in test runner** via `tsx` — no Jest/Mocha
- Single runtime dependency: `jdk-utils` (JDK discovery)

## Commands

```bash
bun run test                                      # compile + lint + full suite (pretest hook)
node --import tsx --test test/build/vsCodeSettingsWriter.test.ts   # single test file
bun run lint                                      # eslint (flat config)
bun run compile                                   # tsc only
bun run package                                   # build the .vsix
```

## Architecture

The extension is a **step pipeline**. `extension.ts` registers the
`jaenvtix.configureJava` command; `configuration/configureJavaCommand.ts`
defines the ordered step list in `getDefaultStepGroups()` (pre-confirm
validation steps, then post-confirm download/write steps under a progress UI).

- Every step implements `ConfigurationStep` (`core/types.ts`) and communicates
  through the shared mutable `JavaConfigurationState`. **Steps are
  order-dependent**: later steps read state populated by earlier ones.
- Steps return `StepResult.success() / .warning(msg) / .error(msg)` — never
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
  `console.log` — `activate()` wires the sink to the "Jaenvtix" output channel;
  the console default exists only so tests run without an extension host.
- Tests run under plain Node — **no extension host**. Modules with logic under
  test must not import `vscode` at top level; inject dependencies via an
  optional `deps` constructor parameter (see `ValidateEnvironmentStep`,
  `ScheduleDownloadsStep` for the pattern).
- Tests use real filesystem I/O against temp dirs (`test/fixtures/tempDir.ts`)
  and local HTTP servers (`test/fixtures/http.ts`) — no mocking framework.
- JSDoc on non-trivial functions documents **business rules**, not mechanics.
  Follow the existing `Business rules:` section style.

## Critical invariants

<!-- The section that matters most: rules Claude cannot infer from one file. -->

- **Cooperation, not substitution.** Every writer merges non-destructively:
  user-authored entries in `settings.json`, `toolchains.xml`, and
  `java.configuration.runtimes` are preserved verbatim. The `default` flag on
  runtimes belongs to the user — never set or strip it.
- **Respect `mvnw`.** When a project ships its own Maven wrapper, leave
  `maven.executable.path` unset and skip the Jaenvtix Maven download for it.
- **Java version boundary** (`TOOLING_JAVA_MIN_VERSION = 21`): Java 21+
  projects get `java.jdt.ls.java.home`; older projects get a
  `java.configuration.runtimes` entry instead — never both.
- **Idempotency.** Every file writer does change detection and returns
  `updated: false` on no-ops so re-runs don't bump mtimes or spam logs.
- The state keys in `activation/autoConfigPrompt.ts`
  (`jaenvtix.autoConfigPromptDismissed`, `jaenvtix.autoConfigGeneration`) are a
  persistence contract — renaming them re-prompts every existing user.
  `autoConfigPromptDismissed` also has a legacy value shape (a bare `true`)
  that `normalizeRecord` must keep reading.
- **No silent path at activation.** Nothing is written to any workspace without
  an answer for that workspace. Do not add a global opt-in: one existed
  ("Always") and was removed, because it produced a state the user could
  neither see nor escape, where a workspace with no language support was
  neither configured nor offered the install.
- **The activation prompt is triggered by project state, not by history.** A
  project with a pom and no configuration gets asked, whatever was answered
  before: a past "Yes" does not configure anything today, and anchoring on
  "already answered" is what let workspaces go permanently silent while
  genuinely broken. `'declined'` is the single exception and is permanent,
  which is what keeps the rule from nagging.
- **"Is it configured?" is answered from the recorded path list**
  (`isWorkspaceConfigured`), never by scanning. Every successful run records the
  `settings.json` of each resolved project; activation stats them. Scanning at
  activation is the cost the `workspaceContains` fix exists to avoid.
- Unrecognized persisted state always fails towards asking, never towards
  silence — the user has no other way to reach the prompt.

## Architecture constraints

- **Zero new runtime dependencies.** ZIP/TAR extraction, XML parsing, and HTTP
  downloads are hand-rolled on purpose to keep the `.vsix` lean. Do not add
  libraries for these.
- Jaenvtix only writes inside `~/.jaenvtix/`, `~/.m2/`, and each project's
  `.vscode/` — it never moves or modifies system JDK installations.
