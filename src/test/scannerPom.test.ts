import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { resolveJavaVersion, scanWorkspaceForPom } from "../modules/scannerPom";

suite("scannerPom", () => {
    const { tmpdir } = os;
    const tempDirectories: string[] = [];

    async function createWorkspace(): Promise<string> {
        const directory = await fs.mkdtemp(path.join(tmpdir(), "scanner-pom-"));
        tempDirectories.push(directory);

        return directory;
    }

    async function writePom(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
    }

    teardown(async () => {
        await Promise.all(
            tempDirectories.map(async (directory) => {
                await fs.rm(directory, { recursive: true, force: true });
            }),
        );

        tempDirectories.length = 0;
    });

    test("scanWorkspaceForPom resolves single module version", async () => {
        const workspace = await createWorkspace();
        const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>single-app</artifactId>
    <version>1.0.0</version>
    <properties>
        <java.version>21</java.version>
    </properties>
</project>`;

        const pomPath = path.join(workspace, "pom.xml");
        await writePom(pomPath, pomContent);

        const results = await scanWorkspaceForPom(workspace);

        assert.deepStrictEqual(results, [
            {
                path: pomPath,
                javaVersion: "21",
            },
        ]);
    });

    test("scanWorkspaceForPom discovers multi-module project", async () => {
        const workspace = await createWorkspace();

        await writePom(
            path.join(workspace, "pom.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <modules>
        <module>module-a</module>
        <module>module-b</module>
    </modules>
    <properties>
        <java.version>17</java.version>
    </properties>
</project>`,
        );

        await writePom(
            path.join(workspace, "module-a", "pom.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <build>
        <plugins>
            <plugin>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <release>21</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`,
        );

        await writePom(
            path.join(workspace, "module-b", "pom.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <properties>
        <maven.compiler.source>1.8</maven.compiler.source>
    </properties>
</project>`,
        );

        const results = await scanWorkspaceForPom(workspace);

        assert.deepStrictEqual(results, [
            {
                path: path.join(workspace, "module-a", "pom.xml"),
                javaVersion: "21",
            },
            {
                path: path.join(workspace, "module-b", "pom.xml"),
                javaVersion: "1.8",
            },
            {
                path: path.join(workspace, "pom.xml"),
                javaVersion: "17",
            },
        ]);
    });

    test("resolveJavaVersion returns undefined when missing", async () => {
        const workspace = await createWorkspace();

        await writePom(
            path.join(workspace, "pom.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
</project>`,
        );

        const version = await resolveJavaVersion(path.join(workspace, "pom.xml"));

        assert.strictEqual(version, undefined);
    });
});
