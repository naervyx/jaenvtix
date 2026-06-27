import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {getChocolateyToolsRoot, getHomebrewPrefixes} from '../core/system';

/** Package managers Jaenvtix scans for JDK installations beyond `jdk-utils`. */
export type JdkSource = 'chocolatey' | 'homebrew';

/**
 * A directory that structurally looks like a JDK home (it has `bin/javac`)
 * found under a package manager's installation root. Version and javac
 * validity are confirmed later by `jdk-utils.getRuntime`.
 */
export interface PackageManagerJdkCandidate {
    jdkHome: string;
    source: JdkSource;
}

const JDK_PACKAGE_NAME = /jdk|openjdk|temurin|corretto|liberica|zulu/i;

function readdirSafe(dir: string): string[] {
    try {
        return existsSync(dir) ? readdirSync(dir) : [];
    } catch {
        return [];
    }
}

function hasJavac(dir: string, javacName: string): boolean {
    try {
        return existsSync(join(dir, 'bin', javacName));
    } catch {
        return false;
    }
}

/**
 * Returns the JDK homes at `dir`: the directory itself when it has
 * `bin/javac`, otherwise any immediate child that does (covers versioned
 * layouts like `openjdk/tools/jdk-21.0.1/`). Never recurses deeper.
 */
function jdkHomesUnder(dir: string, javacName: string): string[] {
    if (hasJavac(dir, javacName)) {
        return [dir];
    }
    return readdirSafe(dir)
        .map((child) => join(dir, child))
        .filter((child) => hasJavac(child, javacName));
}

/**
 * Scans a Chocolatey installation root for JDK packages.
 *
 * Business rules:
 * - Only entries whose name suggests a JDK package are inspected
 *   (`jdk`, `openjdk`, `temurin`, `corretto`, `liberica`, `zulu`).
 * - Both layouts are covered: `<root>/<pkg>/tools/...` (default lib layout)
 *   and `<root>/<pkg>/...` directly (`ChocolateyToolsLocation` layout).
 * - Returns an empty list off Windows or when the root does not exist;
 *   scan failures are swallowed — discovery must never block the pipeline.
 */
export function scanChocolatey(
    root: string | null = getChocolateyToolsRoot(),
): PackageManagerJdkCandidate[] {
    if (!root || !existsSync(root)) {
        return [];
    }

    const results: PackageManagerJdkCandidate[] = [];
    for (const entry of readdirSafe(root)) {
        if (!JDK_PACKAGE_NAME.test(entry)) {
            continue;
        }

        const packageDir = join(root, entry);
        const homes = new Set([
            ...jdkHomesUnder(packageDir, 'javac.exe'),
            ...jdkHomesUnder(join(packageDir, 'tools'), 'javac.exe'),
        ]);
        for (const jdkHome of homes) {
            results.push({jdkHome, source: 'chocolatey'});
        }
    }

    return results;
}

/**
 * Resolves the actual JDK home for a Homebrew formula directory: either the
 * directory itself or the macOS bundle layout
 * (`libexec/openjdk.jdk/Contents/Home`).
 */
function homebrewJdkHome(formulaDir: string): string | null {
    if (hasJavac(formulaDir, 'javac')) {
        return formulaDir;
    }

    const bundleHome = join(formulaDir, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
    if (hasJavac(bundleHome, 'javac')) {
        return bundleHome;
    }

    return null;
}

/**
 * Scans Homebrew prefixes for `openjdk` formulae.
 *
 * Business rules:
 * - `opt/openjdk...` symlinks (the "current" version per formula) and
 *   `Cellar/openjdk.../<version>` directories (every installed version) are
 *   both scanned; the macOS bundle layout is resolved in either case.
 * - Returns an empty list on platforms without Homebrew prefixes; scan
 *   failures are swallowed — discovery must never block the pipeline.
 */
export function scanHomebrew(
    prefixes: readonly string[] = getHomebrewPrefixes(),
): PackageManagerJdkCandidate[] {
    const results: PackageManagerJdkCandidate[] = [];

    for (const prefix of prefixes) {
        for (const optEntry of readdirSafe(join(prefix, 'opt'))) {
            if (!optEntry.startsWith('openjdk')) {
                continue;
            }
            const jdkHome = homebrewJdkHome(join(prefix, 'opt', optEntry));
            if (jdkHome) {
                results.push({jdkHome, source: 'homebrew'});
            }
        }

        for (const cellarEntry of readdirSafe(join(prefix, 'Cellar'))) {
            if (!cellarEntry.startsWith('openjdk')) {
                continue;
            }
            for (const version of readdirSafe(join(prefix, 'Cellar', cellarEntry))) {
                const jdkHome = homebrewJdkHome(join(prefix, 'Cellar', cellarEntry, version));
                if (jdkHome) {
                    results.push({jdkHome, source: 'homebrew'});
                }
            }
        }
    }

    return results;
}

/** All package-manager JDK candidates on this machine (Chocolatey + Homebrew). */
export function scanPackageManagerJdks(): PackageManagerJdkCandidate[] {
    return [...scanChocolatey(), ...scanHomebrew()];
}
