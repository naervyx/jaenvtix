import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {scanXml} from './xmlScanner';

/**
 * Launch metadata resolved for a Maven project:
 * the fully-qualified main class, the Maven artifact ID (used as the VS Code
 * project name in the launch config), and whether the project is a Spring Boot app.
 */
export interface JavaLaunchInfo {
    mainClass: string | null;
    projectName?: string;
    isSpringBoot: boolean;
}

const SPRING_BOOT_ANNOTATION = /@\s*SpringBootApplication\b/;
const MAIN_METHOD_PATTERN = /\bpublic\s+static\s+void\s+main\s*\(/;
const PACKAGE_PATTERN = /(?:^|\s)package\s+([A-Za-z0-9_.]+)\s*;/m;

/** Extracts the value of the `<artifactId>` that is a direct child of `<project>`. */
function parseArtifactIdFromXml(xml: string): string | null {
    const tagStack: string[] = [];
    let capturedTagName: string | undefined;
    let capturedDepth = 0;
    let capturedText = '';
    let result: string | null = null;

    const beginCapture = (tagName: string): void => {
        capturedTagName = tagName;
        capturedDepth = tagStack.length;
        capturedText = '';
    };

    const endCapture = (closingTagName: string): void => {
        if (!capturedTagName) {return;}
        if (capturedTagName !== closingTagName) {return;}
        if (capturedDepth !== tagStack.length) {return;}

        const value = capturedText.trim();
        capturedTagName = undefined;
        capturedText = '';

        if (value) {
            result = value;
        }
    };

    scanXml(xml, {
        onOpenTag: (tagName) => {
            tagStack.push(tagName);

            if (result) {return;}
            if (tagName !== 'artifactId') {return;}

            const parent = tagStack.at(-2);
            if (parent === 'project') {
                beginCapture(tagName);
            }
        },
        onCloseTag: (tagName) => {
            endCapture(tagName);
            tagStack.pop();
        },
        onText: (text) => {
            if (!capturedTagName) {return;}
            if (tagStack.length !== capturedDepth) {return;}
            if (tagStack.at(-1) !== capturedTagName) {return;}
            capturedText += text;
        },
        isDone: () => result !== null,
    });

    return result;
}

function parsePomProperties(xml: string): Map<string, string> {
    const properties = new Map<string, string>();
    const match = /<properties>([\s\S]*?)<\/properties>/i.exec(xml);
    if (!match) {return properties;}

    const block = match[1];
    const propPattern = /<([A-Za-z0-9_.-]+)>([\s\S]*?)<\/\1>/g;
    let current: RegExpExecArray | null;

    while ((current = propPattern.exec(block))) {
        const key = current[1]?.trim();
        const value = current[2]?.trim();
        if (key && value) {
            properties.set(key, value);
        }
    }

    return properties;
}

function findPomTagValue(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = pattern.exec(xml);
    const value = match?.[1]?.trim() ?? '';
    return value ? value : null;
}

function resolvePropertyReferences(value: string, properties: Map<string, string>): string | null {
    if (!value.includes('${')) {return value.trim();}

    let unresolved = false;
    const replaced = value.replace(/\$\{([^}]+)}/g, (_, key) => {
        const resolved = properties.get(String(key));
        if (!resolved) {
            unresolved = true;
            return '';
        }
        return resolved;
    }).trim();

    if (unresolved || !replaced) {
        return null;
    }

    return replaced;
}

/**
 * Extracts the main class and Spring Boot flag from a `pom.xml` XML string.
 * Checks `<start-class>` (Spring Boot) and `<mainClass>` properties, resolving
 * any `${property}` references against the `<properties>` block.
 */
function parsePomLaunchInfo(xml: string): JavaLaunchInfo {
    const properties = parsePomProperties(xml);
    const artifactId = parseArtifactIdFromXml(xml) ?? undefined;

    const startClassRaw = findPomTagValue(xml, 'start-class');
    const startClass = startClassRaw ? resolvePropertyReferences(startClassRaw, properties) : null;
    const mainClassRaw = findPomTagValue(xml, 'mainClass');
    const mainClass = mainClassRaw ? resolvePropertyReferences(mainClassRaw, properties) : null;

    return {
        mainClass: startClass ?? mainClass,
        projectName: artifactId,
        isSpringBoot: Boolean(startClass),
    };
}

/** Extracts the `package` declaration from Java source content, or `null` if absent. */
function readPackageName(content: string): string | null {
    return PACKAGE_PATTERN.exec(content)?.[1] ?? null;
}

/** Returns the name of the first `class` declared at or after `index` in the source. */
function findClassNameAfter(content: string, index: number): string | null {
    const match = /\bclass\s+([A-Za-z0-9_]+)\b/.exec(content.slice(index));
    return match?.[1] ?? null;
}

/** Returns the name of the first `class` declared anywhere in the source. */
function findFirstClassName(content: string): string | null {
    const match = /\bclass\s+([A-Za-z0-9_]+)\b/.exec(content);
    return match?.[1] ?? null;
}

/**
 * Returns the name of the class that contains `public static void main`.
 * Finds the last `class` declaration before the `main` method signature,
 * which handles inner classes by attributing the method to the enclosing class.
 */
function findMainMethodClassName(content: string): string | null {
    const mainIndex = content.search(MAIN_METHOD_PATTERN);
    if (mainIndex < 0) {return null;}

    const beforeMain = content.slice(0, mainIndex);
    const matches = [...beforeMain.matchAll(/\bclass\s+([A-Za-z0-9_]+)\b/g)];
    const lastMatch = matches.at(-1);
    return lastMatch?.[1] ?? null;
}

function toQualifiedClassName(packageName: string | null, className: string | null): string | null {
    if (!className) {return null;}
    if (!packageName) {return className;}
    return `${packageName}.${className}`;
}

/** Recursively collects all `.java` file paths under `root` into `files`. */
function collectJavaFiles(root: string, files: string[]): void {
    if (!existsSync(root)) {return;}

    const entries = readdirSync(root, {withFileTypes: true});
    for (const entry of entries) {
        const entryPath = join(root, entry.name);
        if (entry.isDirectory()) {
            collectJavaFiles(entryPath, files);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.java')) {
            files.push(entryPath);
        }
    }
}

/**
 * Scans `src/main/java` for the main class. Spring Boot classes annotated with
 * `@SpringBootApplication` take priority; otherwise the first class with a
 * `public static void main` method is returned.
 */
function findMainClassInSources(projectPath: string): {mainClass: string | null; isSpringBoot: boolean} {
    const sourceRoot = join(projectPath, 'src', 'main', 'java');
    const javaFiles: string[] = [];
    collectJavaFiles(sourceRoot, javaFiles);

    let mainCandidate: string | null = null;

    for (const filePath of javaFiles) {
        let content = '';
        try {
            content = readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        const packageName = readPackageName(content);
        const springMatch = SPRING_BOOT_ANNOTATION.exec(content);
        if (springMatch) {
            const className = findClassNameAfter(content, springMatch.index + springMatch[0].length)
                ?? findFirstClassName(content);
            const qualified = toQualifiedClassName(packageName, className);
            if (qualified) {
                return {mainClass: qualified, isSpringBoot: true};
            }
        }

        if (!mainCandidate) {
            const mainClassName = findMainMethodClassName(content);
            const qualified = toQualifiedClassName(packageName, mainClassName);
            if (qualified) {
                mainCandidate = qualified;
            }
        }
    }

    return {mainClass: mainCandidate, isSpringBoot: false};
}

/**
 * Resolves the launch info for a Maven project at `projectPath`.
 *
 * Business rules:
 * - Tries `pom.xml` first: checks `<start-class>` (Spring Boot) and
 *   `<mainClass>` properties (with `${ref}` resolution). When found, uses
 *   the `<artifactId>` as the project name in the launch config.
 * - If `pom.xml` yields no main class, falls back to scanning `.java` files
 *   under `src/main/java`. A `@SpringBootApplication` class takes priority
 *   over a class with a bare `main` method.
 * - Always returns a `JavaLaunchInfo`; `mainClass` is `null` when no main
 *   entry point can be found — the caller decides whether to skip or warn.
 */
export function resolveJavaLaunchInfo(projectPath: string): JavaLaunchInfo {
    const pomPath = join(projectPath, 'pom.xml');

    if (existsSync(pomPath)) {
        try {
            const pomXml = readFileSync(pomPath, 'utf-8');
            const pomInfo = parsePomLaunchInfo(pomXml);
            if (pomInfo.mainClass) {
                return pomInfo;
            }

            const sourceInfo = findMainClassInSources(projectPath);
            return {
                mainClass: sourceInfo.mainClass,
                projectName: pomInfo.projectName,
                isSpringBoot: sourceInfo.isSpringBoot || pomInfo.isSpringBoot,
            };
        } catch {
            return findMainClassInSources(projectPath);
        }
    }

    return findMainClassInSources(projectPath);
}
