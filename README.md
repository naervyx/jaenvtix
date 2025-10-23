# Jaenvtix — Auto‑Setup (JDK & Maven) for Visual Studio Code

A **lightweight, deterministic** extension that, when you open a **Java/Maven** project, **detects the Java version** from `pom.xml`, **provisions** a compatible **Oracle JDK** for your OS/arch — with **OpenJDK fallback** (e.g., Amazon Corretto) when Oracle isn’t viable — **couples** a Maven/mvnd to that JDK, updates `~/.m2/toolchains.xml`, and writes `.vscode/settings.json` for the workspace. Result: **open the project and immediately run, debug, test, and use Maven with zero setup**.

---

## Recommended extensions

For the best Java experience, Jaenvtix can **suggest** (optional):

- **[Extension Pack for Java](https://marketplace.cursorapi.com/items/?itemName=vscjava.vscode-java-pack)** (Language Support, Debugger, Test Runner, Maven/Gradle).

These are **optional** — Jaenvtix works without them, but features like **IntelliSense/Debug/Testing** rely on these extensions.

---

## Quick start

1. **Install** Jaenvtix in VS Code/Cursor.
2. **Open** a folder containing a `pom.xml` (multi‑module projects are supported).
3. Follow the **prompts**: Oracle‑first → manual or fallback when needed.
4. When done, use:
    - **Run/Debug** (F5 or ▶️ in the editor)
    - **Test Explorer** for JUnit/TestNG
    - **Terminal** with `mvn-jaenvtix` (wrapper with fixed `JAVA_HOME`)

### Develop or test the extension locally

To build the extension and launch the VS Code Extension Development Host in one go, run:

```bash
npm run dev
```

This script performs the full compilation (type-check, lint, bundle) before starting the host with the current workspace loaded.

> Tip: if the project has `mvnw`, it is **respected**; `JAVA_HOME` is still pinned to the provisioned JDK.

---

## Configure your environment

- **Status Bar**: shows the **active JDK** for the workspace.
- **Debugger**: use the **Run and Debug** view (default `launch.json` patterns work).
- **Maven**: Jaenvtix writes `maven.executable.path` pointing to `mvn-jaenvtix` and enables `maven.terminal.useJavaHome = true`.
- **Workspace metadata**: `.vscode/settings.json` is updated with `jaenvtix.*` keys (release, vendor, `javaHome`, `mavenExecutable`, `toolchainsPath`). If the project ships a `mvnw`, it is preserved and wired automatically.
- **Toolchains**: merges/updates `~/.m2/toolchains.xml` with entries by **version** and **vendor**.

---

## Commands

Open the **Command Palette** (⌘⇧P on macOS, Ctrl+Shift+P on Windows/Linux) and search for **Jaenvtix**:

| Command | Description |
|---|---|
| **Jaenvtix: Detect Java version** | Re‑scans `pom.xml` files and determines the target version (multi‑module → highest version). |
| **Jaenvtix: Provision/Update JDK** | Downloads/installs (Oracle‑first; OpenJDK fallback when needed). |
| **Jaenvtix: Reinstall mvnd** | Reinstalls **mvnd** coupled to the JDK of this version. |
| **Jaenvtix: Open toolchains.xml** | Ensures/opens `~/.m2/toolchains.xml` in the editor for review. |
| **Jaenvtix: Clean cache/temporary files** | Removes `~/.jaenvtix/temp` and recreates the directory for fresh downloads. |

---

## Feature details

- **Oracle‑first**: prioritizes **Oracle JDK**; uses **OpenJDK** (e.g., Amazon Corretto) when Oracle is not automatable/viable.
- **LTS first**: native support for **8, 11, 17, 21, 25**; **non‑LTS (Preview)** is optional, with stability warning.
- **Per‑version isolation**: each JDK has its own **mvnd**/Maven **coupled** (avoids project conflicts).
- **Zero friction**: `JAVA_HOME` pinned per workspace; run, debug, tests, and Maven ready on open.
- **No global installs**: everything lives under the user **HOME** (`~/.jaenvtix/`).
- **Transparency & compliance**: surfaces source/license; asks for consent to terms when required.
- **Integrity**: validates **checksums** when available; on failure, aborts with a clear warning.

---

## Folder layout

```
~/.jaenvtix/
  temp/                           # Temporary downloads
  jdk-1.8/
    <jdk-version...>/            # Priority is Oracle JDK or use OpenJDK for fallback
    mvn-custom/
      bin/
        mvnd.exe
        mvn-jaenvtix.cmd        # Wrapper pinning JAVA_HOME to THIS JDK
  jdk-11/...
  jdk-17/...
  jdk-21/...
  jdk-25/...
```

> Note: We do not create our own "toolchains/" folder; we will place it in the default path **create or update `~/.m2/toolchains.xml`**.

---

## System requirements

- **Desktop**: VS Code or Cursor.
- **Network** for downloads (or point to an already downloaded **local JDK**).
- **Extraction tools**:
    - **Windows**: PowerShell `Expand-Archive`
    - **macOS/Linux**: `tar` and `unzip` available on `PATH`

---

## Extension settings

Tune behavior via **Settings** (or `settings.json`):

| Key | Type | Default | Description |
|---|---|---|---|
| `jaenvtix.preferOracle` | boolean | `true` | Prefer Oracle JDK when possible. |
| `jaenvtix.allowPreviewJdk` | boolean | `false` | Allow non‑LTS (preview) with warning. |
| `jaenvtix.fallbackVendor` | string | `"corretto"` | Fallback OpenJDK vendor (`corretto`, `temurin`, etc.). |
| `jaenvtix.checksumPolicy` | string | `"best-effort"` | `strict` (fail without checksum) or `best-effort`. |
| `jaenvtix.cleanupDownloads` | boolean | `true` | Remove temporary artifacts after install. |
| `jaenvtix.toolchainsPath` | string | _auto_ | Alternate path for `toolchains.xml`.

Example (`.vscode/settings.json`):

```json
{
  "jaenvtix.preferOracle": true,
  "jaenvtix.allowPreviewJdk": false,
  "jaenvtix.fallbackVendor": "corretto",
  "jaenvtix.checksumPolicy": "strict"
}
```

---

## FAQ

**My project has `mvnw`. Does Jaenvtix interfere?**  
No. We respect the project’s `mvnw`. `JAVA_HOME` still points to the provisioned JDK.

**How is the Java version decided in multi‑module builds?**  
We use the **highest** version found across modules (from the `maven-compiler-plugin`’s `<release>`, properties like `maven.compiler.release`, `maven.compiler.source/target`, or `java.version`).

**What if Oracle requires a login/consent we can’t automate?**  
We offer manual install (choose file/folder) **or** fallback to OpenJDK.

**macOS blocked the extracted binary**  
Remove the quarantine attribute manually and reopen VS Code.

---

## Locales

Available in **en-US**. More locales may be added on demand.

---

## Report issues, ideas, and contribute

Contributions are **welcome**! Open **issues** and **PRs** with suggestions, improvements, and fixes.

---

## Data and telemetry

Jaenvtix **don't collect telemetry**. The extension performs **downloads** of JDK/Maven from official sources (Oracle/OpenJDK) and may ask for your **consent** to terms/licenses when required by those sources.

---

## License

**MIT**

