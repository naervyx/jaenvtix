import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {resolveJavaLaunchInfo} from '../../src/search/javaLaunchInfo';
import {createProject, javaSource, pom, type ProjectFile} from '../fixtures/project';
import {removeTempDir} from '../fixtures/tempDir';

const cleanups: string[] = [];

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map(removeTempDir));
});

async function project(files: ProjectFile[]): Promise<string> {
    const root = await createProject(files);
    cleanups.push(root);
    return root;
}

describe('resolveJavaLaunchInfo — pom-based detection', () => {
    it('reads <start-class> from a Spring Boot pom and flags isSpringBoot', async () => {
        const root = await project([
            pom(`<?xml version="1.0"?>
<project>
    <artifactId>demo-service</artifactId>
    <properties>
        <start-class>com.example.demo.DemoApplication</start-class>
    </properties>
</project>`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.demo.DemoApplication');
        assert.equal(info.projectName, 'demo-service');
        assert.equal(info.isSpringBoot, true);
    });

    it('resolves ${...} property references inside <start-class>', async () => {
        const root = await project([
            pom(`<?xml version="1.0"?>
<project>
    <artifactId>demo-service</artifactId>
    <properties>
        <main.package>com.example.demo</main.package>
        <start-class>\${main.package}.DemoApplication</start-class>
    </properties>
</project>`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.demo.DemoApplication');
        assert.equal(info.isSpringBoot, true);
    });

    it('reads <mainClass> when no <start-class> exists and does NOT flag Spring Boot', async () => {
        const root = await project([
            pom(`<?xml version="1.0"?>
<project>
    <artifactId>cli-tool</artifactId>
    <properties>
        <mainClass>com.example.cli.Main</mainClass>
    </properties>
</project>`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.cli.Main');
        assert.equal(info.isSpringBoot, false);
    });

    it('returns the pom artifactId as projectName even when source scanning finds the main class', async () => {
        const root = await project([
            pom(`<?xml version="1.0"?>
<project>
    <artifactId>scanned-app</artifactId>
</project>`),
            javaSource('com.example.app', 'App.java', `package com.example.app;

public class App {
    public static void main(String[] args) {}
}`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.app.App');
        assert.equal(info.projectName, 'scanned-app');
        assert.equal(info.isSpringBoot, false);
    });
});

describe('resolveJavaLaunchInfo — source scanning', () => {
    it('locates a public-static-void-main class under src/main/java', async () => {
        const root = await project([
            javaSource('com.example.cli', 'Cli.java', `package com.example.cli;

public class Cli {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.cli.Cli');
        assert.equal(info.isSpringBoot, false);
    });

    it('detects @SpringBootApplication and prefers it even if a plain main exists earlier', async () => {
        const root = await project([
            javaSource('com.example.plain', 'Plain.java', `package com.example.plain;

public class Plain {
    public static void main(String[] args) {}
}`),
            javaSource('com.example.boot', 'BootApp.java', `package com.example.boot;

import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BootApp {
    public static void main(String[] args) {}
}`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'com.example.boot.BootApp');
        assert.equal(info.isSpringBoot, true);
    });

    it('returns mainClass=null when no main method and no Spring Boot annotation exist', async () => {
        const root = await project([
            javaSource('com.example.lib', 'Lib.java', `package com.example.lib;

public class Lib {
    public String greet() { return "hi"; }
}`),
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, null);
        assert.equal(info.isSpringBoot, false);
    });

    it('handles classes in the default (no-package) namespace', async () => {
        const root = await project([
            {
                relativePath: 'src/main/java/Default.java',
                content: `public class Default {
    public static void main(String[] args) {}
}`,
            },
        ]);

        const info = resolveJavaLaunchInfo(root);
        assert.equal(info.mainClass, 'Default');
    });
});
