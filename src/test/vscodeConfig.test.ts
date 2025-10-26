import * as assert from "assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parse } from "jsonc-parser";

import { updateWorkspaceSettings } from "../modules/vscodeConfig";

suite("vscodeConfig", () => {
    test("updateWorkspaceSettings creates managed keys when settings file is missing", async () => {
        const workspace = await createWorkspace();
        const javaHome = path.join(workspace, "jdk");
        const mavenWrapper = path.join(workspace, "mvn-jaenvtix");

        try {
            await updateWorkspaceSettings(workspace, { javaHome, mavenWrapper });

            const settingsContent = await readSettings(workspace);
            const parsed = parse(settingsContent) as Record<string, unknown>;

            assert.strictEqual(parsed["java.jdt.ls.java.home"], javaHome);
            assert.strictEqual(parsed["maven.executable.path"], mavenWrapper);
            assert.strictEqual(parsed["maven.terminal.useJavaHome"], true);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("updateWorkspaceSettings preserves unmanaged keys and remains idempotent", async () => {
        const workspace = await createWorkspace(`{
    // existing comment
    "files.autoSave": "onFocusChange",
    "maven.executable.path": "./mvnw"
}`);
        const javaHome = path.join(workspace, "jdk-home");
        const mavenWrapper = path.join(workspace, "bin", "mvn-jaenvtix");

        try {
            await updateWorkspaceSettings(workspace, { javaHome, mavenWrapper });
            const firstPass = await readSettings(workspace);

            await updateWorkspaceSettings(workspace, { javaHome, mavenWrapper });
            const secondPass = await readSettings(workspace);

            assert.strictEqual(firstPass, secondPass, "subsequent merges should not alter content");

            const parsed = parse(secondPass) as Record<string, unknown>;
            assert.strictEqual(parsed["java.jdt.ls.java.home"], javaHome);
            assert.strictEqual(parsed["maven.executable.path"], mavenWrapper);
            assert.strictEqual(parsed["maven.terminal.useJavaHome"], true);
            assert.strictEqual(parsed["files.autoSave"], "onFocusChange");
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });
});

async function createWorkspace(initialSettings?: string): Promise<string> {
    const prefix = path.join(os.tmpdir(), "jaenvtix-vscode-config-test-");
    const workspace = await fs.mkdtemp(prefix);

    if (initialSettings) {
        const vscodeDir = path.join(workspace, ".vscode");
        await fs.mkdir(vscodeDir, { recursive: true });
        await fs.writeFile(path.join(vscodeDir, "settings.json"), `${initialSettings}\n`, "utf8");
    }

    return workspace;
}

async function readSettings(workspace: string): Promise<string> {
    const settingsPath = path.join(workspace, ".vscode", "settings.json");

    return fs.readFile(settingsPath, "utf8");
}
