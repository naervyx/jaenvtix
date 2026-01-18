import {readFileSync} from 'node:fs';
import { join } from 'node:path';

const TAG = {
    javaVersionProperty: 'java.version',
    mavenCompilerReleaseProperty: 'maven.compiler.release',
    mavenCompilerSourceProperty: 'maven.compiler.source',

    properties: 'properties',
    build: 'build',
    plugins: 'plugins',
    plugin: 'plugin',

    artifactId: 'artifactId',
    configuration: 'configuration',

    release: 'release',
    compilerVersion: 'compilerVersion',

    jdkToolchain: 'jdkToolchain',
    version: 'version',
} as const;

const MAVEN_COMPILER_PLUGIN_ARTIFACT_ID = 'maven-compiler-plugin';
const TOOLCHAIN_PLUGIN_ARTIFACT_IDS = new Set<string>([
    'maven-toolchains-plugin',
    'toolchains-maven-plugin',
]);

const JAVA_VERSION_PROPERTY_TAGS = new Set<string>([
    TAG.javaVersionProperty,
    TAG.mavenCompilerReleaseProperty,
    TAG.mavenCompilerSourceProperty,
]);

type PluginKind = 'none' | 'compiler' | 'toolchains';

function getLocalName(qualifiedName: string): string {
    const separatorIndex = qualifiedName.lastIndexOf(':');
    if (separatorIndex < 0) {return qualifiedName;}
    return qualifiedName.slice(separatorIndex + 1);
}

function normalizeJavaVersion(rawInput: string): string | null {
    const trimmed = rawInput.trim();
    if (!trimmed) {return null;}

    const legacyMatch = /^1\.(\d+)/.exec(trimmed);
    if (legacyMatch?.[1]) {return legacyMatch[1];}

    const modernMatch = /^(\d+)/.exec(trimmed);
    return modernMatch?.[1] ?? null;
}

function findTagEndIndex(xml: string, fromIndex: number): number {
    let openQuote: number | 0 = 0;

    for (let index = fromIndex; index < xml.length; index++) {
        const code = xml.charCodeAt(index);

        if (openQuote) {
            if (code === openQuote) {openQuote = 0;}
            continue;
        }

        if (code === 34 || code === 39) {
            openQuote = code;
            continue;
        }

        if (code === 62) {return index;}
    }

    return -1;
}

function readTagLocalName(xml: string, startIndex: number, endIndex: number): string {
    if (startIndex >= endIndex) {return '';}

    let index = startIndex;

    while (index < endIndex) {
        const code = xml.charCodeAt(index);
        if (code <= 32 || code === 47) {break;}
        index++;
    }

    return getLocalName(xml.slice(startIndex, index));
}

function isSelfClosingTag(xml: string, gtIndex: number): boolean {
    if (gtIndex <= 0) {return false;}
    return xml.charCodeAt(gtIndex - 1) === 47;
}

function parseJavaVersionFromXml(xml: string): string | null {
    const tagStack: string[] = [];

    let capturedTagName: string | undefined;
    let capturedTagDepth = 0;
    let capturedText = '';

    let pluginContainerDepth = 0;
    let currentPluginKind: PluginKind = 'none';
    let configurationDepth = 0;
    let jdkToolchainDepth = 0;

    let compilerReleaseValue: string | undefined;
    let compilerVersionValue: string | undefined;
    let toolchainVersionValue: string | undefined;

    let detectedJavaVersion: string | null = null;

    const setResultIfValid = (value: string): boolean => {
        const normalized = normalizeJavaVersion(value);
        if (!normalized) {return false;}
        detectedJavaVersion = normalized;
        return true;
    };

    const beginCapture = (tagName: string): void => {
        capturedTagName = tagName;
        capturedTagDepth = tagStack.length;
        capturedText = '';
    };

    const endCapture = (closingTagName: string): void => {
        if (!capturedTagName) {return;}
        if (capturedTagName !== closingTagName) {return;}
        if (capturedTagDepth !== tagStack.length) {return;}

        const value = capturedText.trim();

        capturedTagName = undefined;
        capturedText = '';

        if (!value) {return;}

        if (JAVA_VERSION_PROPERTY_TAGS.has(closingTagName)) {
            if (setResultIfValid(value)) {return;}
        }

        if (currentPluginKind === 'compiler') {
            if (closingTagName === TAG.release) {
                compilerReleaseValue = value;
                setResultIfValid(value);
                return;
            }

            if (closingTagName === TAG.compilerVersion && !compilerReleaseValue) {
                compilerVersionValue = value;
                setResultIfValid(value);
                return;
            }
        }

        if (currentPluginKind === 'toolchains') {
            if (closingTagName === TAG.version) {
                toolchainVersionValue = value;
                setResultIfValid(value);
                return;
            }
        }

        const isArtifactIdAtPluginRoot =
            closingTagName === TAG.artifactId && tagStack.length === pluginContainerDepth + 1;

        if (!isArtifactIdAtPluginRoot) {return;}

        if (value === MAVEN_COMPILER_PLUGIN_ARTIFACT_ID) {
            currentPluginKind = 'compiler';
            if (compilerReleaseValue && setResultIfValid(compilerReleaseValue)) {return;}
            if (compilerVersionValue) {setResultIfValid(compilerVersionValue);}
            return;
        }

        if (!TOOLCHAIN_PLUGIN_ARTIFACT_IDS.has(value)) {return;}

        currentPluginKind = 'toolchains';
        if (toolchainVersionValue) {setResultIfValid(toolchainVersionValue);}
    };

    const handleOpenTag = (tagName: string): void => {
        tagStack.push(tagName);

        const depth = tagStack.length;
        const parentTag = tagStack.at(-2) ?? '';
        const grandParentTag = tagStack.at(-3) ?? '';

        const isPropertiesChild = parentTag === TAG.properties;
        if (isPropertiesChild && JAVA_VERSION_PROPERTY_TAGS.has(tagName)) {
            beginCapture(tagName);
            return;
        }

        const isBuildPlugin =
            tagName === TAG.plugin && parentTag === TAG.plugins && grandParentTag === TAG.build;

        if (isBuildPlugin) {
            pluginContainerDepth = depth;
            currentPluginKind = 'none';
            configurationDepth = 0;
            jdkToolchainDepth = 0;
            compilerReleaseValue = undefined;
            compilerVersionValue = undefined;
            toolchainVersionValue = undefined;
            return;
        }

        if (!pluginContainerDepth) {return;}

        if (tagName === TAG.artifactId && depth === pluginContainerDepth + 1) {
            beginCapture(tagName);
            return;
        }

        if (tagName === TAG.configuration && depth === pluginContainerDepth + 1) {
            configurationDepth = depth;
            return;
        }

        if (!configurationDepth) {return;}

        const isDirectChildOfConfiguration = parentTag === TAG.configuration;

        if (currentPluginKind === 'compiler') {
            const isCompilerSettingTag = tagName === TAG.release || tagName === TAG.compilerVersion;
            if (isCompilerSettingTag && isDirectChildOfConfiguration) {beginCapture(tagName);}
            return;
        }

        if (currentPluginKind !== 'toolchains') {return;}

        if (tagName === TAG.jdkToolchain) {
            jdkToolchainDepth = depth;
            return;
        }

        const isJdkToolchainChild = parentTag === TAG.jdkToolchain;
        if (tagName === TAG.version && jdkToolchainDepth && isJdkToolchainChild) {
            beginCapture(tagName);
        }
    };

    const handleCloseTag = (tagName: string): void => {
        endCapture(tagName);

        const depth = tagStack.length;

        if (!pluginContainerDepth) {
            tagStack.pop();
            return;
        }

        if (tagName === TAG.jdkToolchain && jdkToolchainDepth === depth) {
            jdkToolchainDepth = 0;
        }

        if (tagName === TAG.configuration && configurationDepth === depth) {
            configurationDepth = 0;
            jdkToolchainDepth = 0;
        }

        const isClosingPluginTag = tagName === TAG.plugin && pluginContainerDepth === depth;
        if (!isClosingPluginTag) {
            tagStack.pop();
            return;
        }

        if (currentPluginKind === 'compiler') {
            if (compilerReleaseValue && setResultIfValid(compilerReleaseValue)) {
                tagStack.pop();
                pluginContainerDepth = 0;
                currentPluginKind = 'none';
                return;
            }

            if (compilerVersionValue) {setResultIfValid(compilerVersionValue);}
        }

        if (currentPluginKind === 'toolchains' && toolchainVersionValue) {
            setResultIfValid(toolchainVersionValue);
        }

        pluginContainerDepth = 0;
        currentPluginKind = 'none';
        tagStack.pop();
    };

    const handleText = (text: string): void => {
        if (!capturedTagName) {return;}
        if (tagStack.length !== capturedTagDepth) {return;}
        if (tagStack.at(-1) !== capturedTagName) {return;}

        capturedText += text;
    };

    let cursor = 0;

    while (cursor < xml.length && !detectedJavaVersion) {
        const ltIndex = xml.indexOf('<', cursor);
        if (ltIndex < 0) {break;}

        if (ltIndex > cursor) {handleText(xml.slice(cursor, ltIndex));}
        cursor = ltIndex;

        if (xml.startsWith('<!--', cursor)) {
            const end = xml.indexOf('-->', cursor + 4);
            cursor = end >= 0 ? end + 3 : xml.length;
            continue;
        }

        if (xml.startsWith('<?', cursor)) {
            const end = xml.indexOf('?>', cursor + 2);
            cursor = end >= 0 ? end + 2 : xml.length;
            continue;
        }

        if (xml.startsWith('<![CDATA[', cursor)) {
            const end = xml.indexOf(']]>', cursor + 9);
            if (end < 0) {break;}
            handleText(xml.slice(cursor + 9, end));
            cursor = end + 3;
            continue;
        }

        if (xml.startsWith('<!', cursor)) {
            const gtIndex = findTagEndIndex(xml, cursor + 2);
            cursor = gtIndex >= 0 ? gtIndex + 1 : xml.length;
            continue;
        }

        const gtIndex = findTagEndIndex(xml, cursor + 1);
        if (gtIndex < 0) {break;}

        if (xml.startsWith('</', cursor)) {
            const closingName = readTagLocalName(xml, cursor + 2, gtIndex);
            cursor = gtIndex + 1;

            if (!closingName) {continue;}
            handleCloseTag(closingName);
            continue;
        }

        const openingName = readTagLocalName(xml, cursor + 1, gtIndex);
        const selfClosing = isSelfClosingTag(xml, gtIndex);
        cursor = gtIndex + 1;

        if (!openingName) {continue;}

        handleOpenTag(openingName);
        if (selfClosing) {handleCloseTag(openingName);}
    }

    return detectedJavaVersion;
}

export function parseJavaVersionFromPom(pomPath: string): string | null {
    try {
        const pomXml = readFileSync(join(pomPath, 'pom.xml'), 'utf-8');
        return parseJavaVersionFromXml(pomXml);
    } catch {
        return null;
    }
}
