import {describe, it, after, before} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {
    buildDefaultM2RepositoryPath,
    buildDefaultM2SettingsPath,
    buildJaenvtixMavenScriptPath,
    buildJdkVersionPath,
    buildMavenBinPath,
    buildMavenInstallationPath,
    buildMavenWrapperPath,
    buildVsCodeLaunchPath,
    buildVsCodePath,
    buildVsCodeSettingPath,
    hasJdkInstallation,
    hasMavenInstallation,
    initializeBaseDirectories,
    resolveJdkInstallationHome,
} from '../../src/build/directory';
import {createTempDir, removeTempDir} from '../fixtures/tempDir';

describe('path builders — pure logic', () => {
    it('builds the per-version JDK home under ~/.jaenvtix', () => {
        assert.equal(buildJdkVersionPath('21'), join(homedir(), '.jaenvtix', 'jdk-21'));
    });

    it('nests the Maven install under the JDK home so each Java version gets its own Maven', () => {
        assert.equal(
            buildMavenInstallationPath('17'),
            join(homedir(), '.jaenvtix', 'jdk-17', 'mvn-custom'),
        );
        assert.equal(
            buildMavenBinPath('17'),
            join(homedir(), '.jaenvtix', 'jdk-17', 'mvn-custom', 'bin'),
        );
    });

    it('returns mvn.cmd on windows and mvn on POSIX for the wrapper', () => {
        assert.equal(buildMavenWrapperPath('/tools/maven/bin', 'windows'), join('/tools/maven/bin', 'mvn.cmd'));
        assert.equal(buildMavenWrapperPath('/tools/maven/bin', 'linux'), join('/tools/maven/bin', 'mvn'));
        assert.equal(buildMavenWrapperPath('/tools/maven/bin', 'darwin'), join('/tools/maven/bin', 'mvn'));
    });

    it('returns jaenvtix-mvn.cmd on windows and jaenvtix-mvn on POSIX', () => {
        assert.equal(
            buildJaenvtixMavenScriptPath('/p', 'windows'),
            join('/p', 'jaenvtix-mvn.cmd'),
        );
        assert.equal(buildJaenvtixMavenScriptPath('/p', 'linux'), join('/p', 'jaenvtix-mvn'));
    });

    it('places .vscode/settings.json and launch.json at the project root', () => {
        assert.equal(buildVsCodePath('/proj'), join('/proj', '.vscode'));
        assert.equal(buildVsCodeSettingPath('/proj'), join('/proj', '.vscode', 'settings.json'));
        assert.equal(buildVsCodeLaunchPath('/proj'), join('/proj', '.vscode', 'launch.json'));
    });

    it('points at ~/.m2 for both settings.xml and the local repository', () => {
        assert.equal(buildDefaultM2SettingsPath(), join(homedir(), '.m2', 'settings.xml'));
        assert.equal(buildDefaultM2RepositoryPath(), join(homedir(), '.m2', 'repository'));
    });
});

describe('hasJdkInstallation', () => {
    let tempRoot: string;

    before(async () => { tempRoot = await createTempDir(); });
    after(async () => { await removeTempDir(tempRoot); });

    it('returns false when bin/java is missing', () => {
        assert.equal(hasJdkInstallation(tempRoot, 'linux'), false);
    });

    it('detects bin/java on POSIX layouts', async () => {
        const jdkHome = join(tempRoot, 'jdk-posix');
        await fs.mkdir(join(jdkHome, 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'bin', 'java'), 'fake');
        assert.equal(hasJdkInstallation(jdkHome, 'linux'), true);
        assert.equal(hasJdkInstallation(jdkHome, 'darwin'), true);
    });

    it('requires bin/java.exe on windows and rejects bin/java alone', async () => {
        const jdkHome = join(tempRoot, 'jdk-win');
        await fs.mkdir(join(jdkHome, 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'bin', 'java'), 'fake');
        assert.equal(hasJdkInstallation(jdkHome, 'windows'), false);
        writeFileSync(join(jdkHome, 'bin', 'java.exe'), 'fake');
        assert.equal(hasJdkInstallation(jdkHome, 'windows'), true);
    });

    it('REGRESSION: detects a macOS bundle layout (Contents/Home/bin/java) on darwin', async () => {
        const jdkHome = join(tempRoot, 'jdk-bundle');
        await fs.mkdir(join(jdkHome, 'Contents', 'Home', 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'Contents', 'Home', 'bin', 'java'), 'fake');
        assert.equal(hasJdkInstallation(jdkHome, 'darwin'), true);
    });
});

describe('resolveJdkInstallationHome', () => {
    let tempRoot: string;

    before(async () => { tempRoot = await createTempDir(); });
    after(async () => { await removeTempDir(tempRoot); });

    it('resolves a plain layout (<home>/bin/java) to the path itself', async () => {
        const jdkHome = join(tempRoot, 'jdk-plain');
        await fs.mkdir(join(jdkHome, 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'bin', 'java'), 'fake');
        assert.equal(resolveJdkInstallationHome(jdkHome, 'linux'), jdkHome);
        assert.equal(resolveJdkInstallationHome(jdkHome, 'darwin'), jdkHome);
    });

    it('resolves a macOS bundle to <home>/Contents/Home on darwin', async () => {
        const jdkHome = join(tempRoot, 'jdk-bundle');
        await fs.mkdir(join(jdkHome, 'Contents', 'Home', 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'Contents', 'Home', 'bin', 'java'), 'fake');
        assert.equal(
            resolveJdkInstallationHome(jdkHome, 'darwin'),
            join(jdkHome, 'Contents', 'Home'),
        );
    });

    it('does not probe the bundle layout on linux or windows', async () => {
        const jdkHome = join(tempRoot, 'jdk-bundle-other-os');
        await fs.mkdir(join(jdkHome, 'Contents', 'Home', 'bin'), {recursive: true});
        writeFileSync(join(jdkHome, 'Contents', 'Home', 'bin', 'java'), 'fake');
        assert.equal(resolveJdkInstallationHome(jdkHome, 'linux'), undefined);
        assert.equal(resolveJdkInstallationHome(jdkHome, 'windows'), undefined);
    });

    it('returns undefined when no java binary exists in either layout', () => {
        assert.equal(resolveJdkInstallationHome(join(tempRoot, 'missing'), 'darwin'), undefined);
    });
});

describe('hasMavenInstallation', () => {
    let tempRoot: string;

    before(async () => { tempRoot = await createTempDir(); });
    after(async () => { await removeTempDir(tempRoot); });

    it('detects mvn on POSIX and mvn.cmd on windows', async () => {
        const binDir = join(tempRoot, 'bin');
        await fs.mkdir(binDir, {recursive: true});

        assert.equal(hasMavenInstallation(binDir, 'linux'), false);
        writeFileSync(join(binDir, 'mvn'), 'fake');
        assert.equal(hasMavenInstallation(binDir, 'linux'), true);
        assert.equal(hasMavenInstallation(binDir, 'darwin'), true);

        assert.equal(hasMavenInstallation(binDir, 'windows'), false);
        writeFileSync(join(binDir, 'mvn.cmd'), 'fake');
        assert.equal(hasMavenInstallation(binDir, 'windows'), true);
    });
});

describe('initializeBaseDirectories', () => {
    it('creates ~/.jaenvtix, ~/.jaenvtix/temp and ~/.m2 idempotently', () => {
        initializeBaseDirectories();
        initializeBaseDirectories();
        assert.equal(existsSync(join(homedir(), '.jaenvtix')), true);
        assert.equal(existsSync(join(homedir(), '.jaenvtix', 'temp')), true);
        assert.equal(existsSync(join(homedir(), '.m2')), true);
    });
});
