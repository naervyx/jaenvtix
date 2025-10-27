import * as assert from "assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ensureSettings, syncToolchains } from "../modules/mavenConfig";

declare module "assert" {
    function rejects(block: Promise<unknown>, error?: unknown): Promise<void>;
}

suite("mavenConfig", () => {
    test("syncToolchains creates file when missing", async () => {
        const workspace = await createWorkspace();
        const toolchainsPath = path.join(workspace, "toolchains.xml");

        try {
            await syncToolchains(
                {
                    vendor: "jaenvtix",
                    versions: ["17"],
                    javaHome: path.join(workspace, "jdks", "17"),
                },
                { toolchainsPath },
            );

            const content = await fs.readFile(toolchainsPath, "utf8");
            assert.strictEqual(
                content,
                `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>17</version>\n      <vendor>jaenvtix</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>${path
                    .join(workspace, "jdks", "17")
                    .replace(/\\/g, "/")}</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`,
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("syncToolchains preserves other entries and comments", async () => {
        const workspace = await createWorkspace(`<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <!-- existing toolchain -->\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>11</version>\n      <vendor>apache</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>/usr/lib/jvm/java-11</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`);
        const toolchainsPath = path.join(workspace, "toolchains.xml");

        try {
            await syncToolchains(
                {
                    vendor: "jaenvtix",
                    versions: ["17"],
                    javaHome: path.join(workspace, "jdks", "17"),
                },
                { toolchainsPath },
            );

            const content = await fs.readFile(toolchainsPath, "utf8");
            assert.strictEqual(
                content,
                `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <!-- existing toolchain -->\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>11</version>\n      <vendor>apache</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>/usr/lib/jvm/java-11</jdkHome>\n    </configuration>\n  </toolchain>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>17</version>\n      <vendor>jaenvtix</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>${path
                    .join(workspace, "jdks", "17")
                    .replace(/\\/g, "/")}</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`,
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("syncToolchains replaces existing entries with same vendor and version", async () => {
        const workspace = await createWorkspace(`<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>17</version>\n      <vendor>jaenvtix</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>/old/path</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`);
        const toolchainsPath = path.join(workspace, "toolchains.xml");
        const javaHome = path.join(workspace, "new-jdk");

        try {
            await syncToolchains(
                {
                    vendor: "jaenvtix",
                    versions: ["17"],
                    javaHome,
                },
                { toolchainsPath },
            );

            const content = await fs.readFile(toolchainsPath, "utf8");
            assert.strictEqual(
                content,
                `<?xml version="1.0" encoding="UTF-8"?>\n<toolchains>\n  <toolchain>\n    <type>jdk</type>\n    <provides>\n      <version>17</version>\n      <vendor>jaenvtix</vendor>\n    </provides>\n    <configuration>\n      <jdkHome>${javaHome.replace(/\\/g, "/")}</jdkHome>\n    </configuration>\n  </toolchain>\n</toolchains>\n`,
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("syncToolchains handles multiple versions", async () => {
        const workspace = await createWorkspace();
        const toolchainsPath = path.join(workspace, "toolchains.xml");
        const javaHome = path.join(workspace, "jdks", "21");

        try {
            await syncToolchains(
                {
                    vendor: "jaenvtix",
                    versions: ["21", "17"],
                    javaHome,
                },
                { toolchainsPath },
            );

            const content = await fs.readFile(toolchainsPath, "utf8");
            assert.match(content, /<version>21<\/version>[\s\S]*<version>17<\/version>/);
            const occurrences = Array.from(content.matchAll(/<toolchain>/g)).length;
            assert.strictEqual(occurrences, 2);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("syncToolchains is idempotent", async () => {
        const workspace = await createWorkspace();
        const toolchainsPath = path.join(workspace, "toolchains.xml");
        const javaHome = path.join(workspace, "jdk", "temurin-21");

        try {
            await syncToolchains(
                {
                    vendor: "eclipse",
                    versions: ["21"],
                    javaHome,
                },
                { toolchainsPath },
            );

            const firstPass = await fs.readFile(toolchainsPath, "utf8");

            await syncToolchains(
                {
                    vendor: "eclipse",
                    versions: ["21"],
                    javaHome,
                },
                { toolchainsPath },
            );

            const secondPass = await fs.readFile(toolchainsPath, "utf8");
            assert.strictEqual(secondPass, firstPass);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test("ensureSettings creates default settings when missing", async () => {
        const workspace = await createWorkspace();
        const settingsPath = path.join(workspace, "settings.xml");

        try {
            const returnedPath = await ensureSettings(settingsPath);
            const content = await fs.readFile(settingsPath, "utf8");

            assert.strictEqual(returnedPath, settingsPath);
            assert.strictEqual(
                content,
                `<?xml version="1.0" encoding="UTF-8"?>\n<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"\n          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">\n</settings>\n`,
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });
});

async function createWorkspace(initialToolchains?: string): Promise<string> {
    const prefix = path.join(os.tmpdir(), "jaenvtix-maven-config-test-");
    const workspace = await fs.mkdtemp(prefix);

    if (initialToolchains) {
        await fs.writeFile(path.join(workspace, "toolchains.xml"), initialToolchains, "utf8");
    }

    return workspace;
}
