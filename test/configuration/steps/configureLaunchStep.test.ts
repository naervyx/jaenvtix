import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {ConfigureLaunchStep} from '../../../src/configuration/steps/configureLaunchStep';
import {createInitialState} from '../../../src/core/types';
import {createProject, javaSource, pom} from '../../fixtures/project';
import {removeTempDir} from '../../fixtures/tempDir';

describe('ConfigureLaunchStep', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn()));
    });

    async function withProject(files: Parameters<typeof createProject>[0]): Promise<string> {
        const root = await createProject(files);
        cleanups.push(() => removeTempDir(root));
        return root;
    }

    it('writes a launch.json with a Java configuration when a main class is found', async () => {
        const root = await withProject([
            javaSource('com.example.app', 'Cli.java', `package com.example.app;
public class Cli { public static void main(String[] args) {} }`),
        ]);
        const state = createInitialState();
        state.projectContexts = [{
            workspace: root, projectPath: root, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        const result = await new ConfigureLaunchStep().run(state);
        assert.equal(result.success, true);

        const launchPath = join(root, '.vscode', 'launch.json');
        assert.ok(existsSync(launchPath));
        const launch = JSON.parse(await fs.readFile(launchPath, 'utf-8'));
        assert.equal(launch.configurations[0].mainClass, 'com.example.app.Cli');
        assert.match(launch.configurations[0].name, /Jaenvtix: Java/);
    });

    it('labels the configuration "Spring Boot" when @SpringBootApplication is detected', async () => {
        const root = await withProject([
            javaSource('com.example.boot', 'BootApp.java', `package com.example.boot;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
public class BootApp { public static void main(String[] args) {} }`),
        ]);
        const state = createInitialState();
        state.projectContexts = [{
            workspace: root, projectPath: root, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        await new ConfigureLaunchStep().run(state);

        const launch = JSON.parse(await fs.readFile(join(root, '.vscode', 'launch.json'), 'utf-8'));
        assert.match(launch.configurations[0].name, /Jaenvtix: Spring Boot/);
    });

    it('skips projects without a discoverable main class without failing', async () => {
        const root = await withProject([
            javaSource('com.example.lib', 'Lib.java', 'package com.example.lib; public class Lib {}'),
        ]);
        const state = createInitialState();
        state.projectContexts = [{
            workspace: root, projectPath: root, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        const result = await new ConfigureLaunchStep().run(state);
        assert.equal(result.success, true);
        assert.equal(existsSync(join(root, '.vscode', 'launch.json')), false);
    });

    it('invokes notifyMalformed when the existing launch.json cannot be parsed', async () => {
        const root = await withProject([
            javaSource('com.example.x', 'X.java', `package com.example.x;
public class X { public static void main(String[] args) {} }`),
        ]);
        await fs.mkdir(join(root, '.vscode'), {recursive: true});
        writeFileSync(join(root, '.vscode', 'launch.json'), '{not-json', 'utf-8');

        const calls: string[] = [];
        const state = createInitialState();
        state.projectContexts = [{
            workspace: root, projectPath: root, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        await new ConfigureLaunchStep({notifyMalformed: (p) => calls.push(p)}).run(state);

        assert.equal(calls.length, 1);
        assert.equal(calls[0], join(root, '.vscode', 'launch.json'));
    });

    it('uses the pom artifactId in the configuration name when available', async () => {
        const root = await withProject([
            pom(`<?xml version="1.0"?>
<project>
    <artifactId>cool-service</artifactId>
    <properties>
        <start-class>com.example.boot.BootApp</start-class>
    </properties>
</project>`),
        ]);
        const state = createInitialState();
        state.projectContexts = [{
            workspace: root, projectPath: root, platform: 'linux', arch: 'x64',
            javaVersion: '21', jdkHome: '/j', toolHome: '/m', toolBin: '/m/b', hasMvnw: false,
        }];

        await new ConfigureLaunchStep().run(state);
        const launch = JSON.parse(await fs.readFile(join(root, '.vscode', 'launch.json'), 'utf-8'));
        assert.match(launch.configurations[0].name, /cool-service/);
        assert.equal(launch.configurations[0].projectName, 'cool-service');
    });
});
