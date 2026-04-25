import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {parseJavaVersionFromPom} from '../../src/search/javaVersion';
import {createProject, pom} from '../fixtures/project';
import {removeTempDir} from '../fixtures/tempDir';

const cleanups: string[] = [];

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map(removeTempDir));
});

async function projectWithPom(xml: string): Promise<string> {
    const root = await createProject([pom(xml)]);
    cleanups.push(root);
    return root;
}

describe('parseJavaVersionFromPom — properties block', () => {
    it('reads <java.version> from <properties>', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <java.version>17</java.version>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '17');
    });

    it('normalizes legacy 1.X notation (1.8 -> 8)', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <java.version>1.8</java.version>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '8');
    });

    it('reads <maven.compiler.release> from properties', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <maven.compiler.release>21</maven.compiler.release>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '21');
    });

    it('reads <maven.compiler.source> from properties when no release is set', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '11');
    });

    it('returns null when the project has no Java configuration', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <groupId>org.example</groupId>
    <artifactId>demo</artifactId>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), null);
    });

    it('returns null when there is no pom.xml', async () => {
        const root = await createProject([]);
        cleanups.push(root);
        assert.equal(parseJavaVersionFromPom(root), null);
    });
});

describe('parseJavaVersionFromPom — maven-compiler-plugin', () => {
    it('reads <release> under the compiler plugin configuration', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <release>17</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '17');
    });

    it('falls back to <compilerVersion> when no <release> is set', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <build>
        <plugins>
            <plugin>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <compilerVersion>1.8</compilerVersion>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '8');
    });

    it('ignores plugins that are not maven-compiler-plugin', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <build>
        <plugins>
            <plugin>
                <artifactId>maven-surefire-plugin</artifactId>
                <configuration>
                    <release>99</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), null);
    });
});

describe('parseJavaVersionFromPom — toolchains plugin', () => {
    it('reads <jdkToolchain><version> from maven-toolchains-plugin', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <build>
        <plugins>
            <plugin>
                <artifactId>maven-toolchains-plugin</artifactId>
                <configuration>
                    <jdkToolchain>
                        <version>21</version>
                    </jdkToolchain>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '21');
    });

    it('also recognises the toolchains-maven-plugin alias', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <build>
        <plugins>
            <plugin>
                <artifactId>toolchains-maven-plugin</artifactId>
                <configuration>
                    <jdkToolchain>
                        <version>17</version>
                    </jdkToolchain>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '17');
    });
});

describe('parseJavaVersionFromPom — robustness', () => {
    it('skips XML comments without picking up commented-out versions', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <!-- <properties><java.version>99</java.version></properties> -->
    <properties>
        <java.version>21</java.version>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '21');
    });

    it('handles CDATA without crashing', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <java.version><![CDATA[17]]></java.version>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), '17');
    });

    it('strips namespace prefixes from tag names (xmlns may decorate maven poms)', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<mvn:project xmlns:mvn="http://maven.apache.org/POM/4.0.0">
    <mvn:properties>
        <mvn:java.version>17</mvn:java.version>
    </mvn:properties>
</mvn:project>`);
        assert.equal(parseJavaVersionFromPom(root), '17');
    });

    it('does NOT pick up <java.version> nested under non-properties branches', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <profiles>
        <profile>
            <id>p</id>
            <java.version>99</java.version>
        </profile>
    </profiles>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), null);
    });

    it('returns null when the version field is empty or whitespace', async () => {
        const root = await projectWithPom(`<?xml version="1.0"?>
<project>
    <properties>
        <java.version>   </java.version>
    </properties>
</project>`);
        assert.equal(parseJavaVersionFromPom(root), null);
    });
});
