import { createReadStream, promises as fsPromises } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

export interface PomScanResult {
    readonly path: string;
    readonly javaVersion?: string;
}

interface PluginState {
    isCompilerPlugin: boolean;
    readonly values: Partial<Record<"release" | "source" | "target", string>>;
}

interface PropertiesState {
    javaVersion?: string;
    mavenCompilerRelease?: string;
    mavenCompilerSource?: string;
    mavenCompilerTarget?: string;
}

const IGNORED_DIRECTORIES = new Set([".git", "target", "node_modules"]);

export async function scanWorkspaceForPom(workspaceRoot: string = process.cwd()): Promise<PomScanResult[]> {
    const resolvedRoot = resolvePath(workspaceRoot);
    const results: PomScanResult[] = [];

    async function traverseDirectory(directory: string): Promise<void> {
        const entries = await fsPromises.readdir(directory, { withFileTypes: true });

        await Promise.all(
            entries.map(async (entry) => {
                const fullPath = join(directory, entry.name);

                if (entry.isDirectory()) {
                    if (IGNORED_DIRECTORIES.has(entry.name)) {
                        return;
                    }

                    await traverseDirectory(fullPath);

                    return;
                }

                if (!entry.isFile() || entry.name.toLowerCase() !== "pom.xml") {
                    return;
                }

                const javaVersion = await resolveJavaVersion(fullPath);
                results.push({
                    path: fullPath,
                    javaVersion,
                });
            }),
        );
    }

    await traverseDirectory(resolvedRoot);

    return results.sort((left, right) => left.path.localeCompare(right.path));
}

export async function resolveJavaVersion(pomPath: string): Promise<string | undefined> {
    const properties: PropertiesState = {};
    let compilerPluginValues: Partial<Record<"release" | "source" | "target", string>> | undefined;
    const elementStack: Array<{ name: string; text: string } & ({ pluginState: PluginState } | { pluginState?: undefined })> = [];
    const pluginStack: PluginState[] = [];

    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(pomPath, { encoding: "utf8" });
        let buffer = "";

        stream.on("error", reject);

        const processBuffer = (): void => {
            while (buffer.length > 0) {
                if (consumeComment()) {
                    continue;
                }

                if (consumeProcessingInstruction()) {
                    continue;
                }

                if (consumeDeclaration()) {
                    continue;
                }

                if (consumeText()) {
                    continue;
                }

                if (!consumeTag()) {
                    return;
                }
            }
        };

        const consumeComment = (): boolean => {
            if (!buffer.startsWith("<!--")) {
                return false;
            }

            const commentEndIndex = buffer.indexOf("-->");

            if (commentEndIndex === -1) {
                return false;
            }

            buffer = buffer.slice(commentEndIndex + 3);

            return true;
        };

        const consumeProcessingInstruction = (): boolean => {
            if (!buffer.startsWith("<?")) {
                return false;
            }

            const declarationEndIndex = buffer.indexOf("?>");

            if (declarationEndIndex === -1) {
                return false;
            }

            buffer = buffer.slice(declarationEndIndex + 2);

            return true;
        };

        const consumeDeclaration = (): boolean => {
            if (!buffer.startsWith("<!") || buffer.startsWith("<!--")) {
                return false;
            }

            const declarationEndIndex = buffer.indexOf(">");

            if (declarationEndIndex === -1) {
                return false;
            }

            buffer = buffer.slice(declarationEndIndex + 1);

            return true;
        };

        const consumeText = (): boolean => {
            const openBracketIndex = buffer.indexOf("<");

            if (openBracketIndex === -1) {
                appendText(buffer);
                buffer = "";

                return false;
            }

            if (openBracketIndex === 0) {
                return false;
            }

            appendText(buffer.slice(0, openBracketIndex));
            buffer = buffer.slice(openBracketIndex);

            return true;
        };

        const consumeTag = (): boolean => {
            if (!buffer.startsWith("<")) {
                return false;
            }

            const closeBracketIndex = buffer.indexOf(">");

            if (closeBracketIndex === -1) {
                return false;
            }

            const tagContent = buffer.slice(1, closeBracketIndex);
            buffer = buffer.slice(closeBracketIndex + 1);

            if (tagContent.endsWith("/")) {
                const tagName = extractTagName(tagContent.slice(0, -1));
                handleOpenTag(tagName, true);
                handleCloseTag(tagName);

                return true;
            }

            if (tagContent.startsWith("/")) {
                const tagName = extractTagName(tagContent.slice(1));
                handleCloseTag(tagName);

                return true;
            }

            const tagName = extractTagName(tagContent);
            handleOpenTag(tagName, false);

            return true;
        };

        const extractTagName = (segment: string): string => {
            const normalized = segment.trim();

            if (!normalized) {
                return "";
            }

            const spaceIndex = normalized.indexOf(" ");

            if (spaceIndex === -1) {
                return normalized;
            }

            return normalized.slice(0, spaceIndex);
        };

        const appendText = (text: string): void => {
            const current = elementStack[elementStack.length - 1];

            if (!current) {
                return;
            }

            current.text += text;
        };

        const handleOpenTag = (tagName: string, selfClosing: boolean): void => {
            const baseState = { name: tagName, text: "" } as { name: string; text: string } & ({ pluginState: PluginState } | { pluginState?: undefined });

            if (tagName === "plugin") {
                const pluginState: PluginState = { isCompilerPlugin: false, values: {} };
                pluginStack.push(pluginState);
                elementStack.push({ ...baseState, pluginState });
            } else {
                elementStack.push(baseState);
            }

            if (selfClosing) {
                handleCloseTag(tagName);
            }
        };

        const handleCloseTag = (tagName: string): void => {
            const element = elementStack.pop();

            if (!element || element.name !== tagName) {
                return;
            }

            const path = [...elementStack.map((state) => state.name), element.name].join("/");
            const trimmedText = element.text.trim();

            captureProperty(path, trimmedText);

            if (element.pluginState) {
                handlePluginElementClose(element.pluginState, tagName, path, trimmedText);

                return;
            }

            handleNestedPluginClose(tagName, path, trimmedText);
        };

        const captureProperty = (path: string, value: string): void => {
            if (!value) {
                return;
            }

            if (path.endsWith("properties/java.version")) {
                properties.javaVersion = value;
            }

            if (path.endsWith("properties/maven.compiler.release")) {
                properties.mavenCompilerRelease = value;
            }

            if (path.endsWith("properties/maven.compiler.source")) {
                properties.mavenCompilerSource = value;
            }

            if (path.endsWith("properties/maven.compiler.target")) {
                properties.mavenCompilerTarget = value;
            }
        };

        const handlePluginElementClose = (
            pluginState: PluginState,
            tagName: string,
            path: string,
            value: string,
        ): void => {
            if (tagName === "plugin") {
                pluginStack.pop();

                if (pluginState.isCompilerPlugin && !compilerPluginValues) {
                    compilerPluginValues = { ...pluginState.values };
                }

                return;
            }

            if (tagName === "artifactId" && value === "maven-compiler-plugin") {
                pluginState.isCompilerPlugin = true;

                return;
            }

            if (!pluginState.isCompilerPlugin || !value) {
                return;
            }

            assignPluginValue(pluginState.values, path, value);
        };

        const handleNestedPluginClose = (tagName: string, path: string, value: string): void => {
            const currentPlugin = pluginStack[pluginStack.length - 1];

            if (!currentPlugin) {
                return;
            }

            if (tagName === "artifactId" && value === "maven-compiler-plugin") {
                currentPlugin.isCompilerPlugin = true;

                return;
            }

            if (!currentPlugin.isCompilerPlugin || !value) {
                return;
            }

            assignPluginValue(currentPlugin.values, path, value);
        };

        const assignPluginValue = (
            container: Partial<Record<"release" | "source" | "target", string>>,
            path: string,
            value: string,
        ): void => {
            if (path.endsWith("configuration/release") && container.release === undefined) {
                container.release = value;
            }

            if (path.endsWith("configuration/source") && container.source === undefined) {
                container.source = value;
            }

            if (path.endsWith("configuration/target") && container.target === undefined) {
                container.target = value;
            }
        };

        stream.on("data", (chunk) => {
            buffer += chunk;
            processBuffer();
        });

        stream.on("end", () => {
            processBuffer();
            resolve();
        });
    });

    const candidates: Array<string | undefined> = [
        compilerPluginValues?.release,
        compilerPluginValues?.source,
        compilerPluginValues?.target,
        properties.mavenCompilerRelease,
        properties.mavenCompilerSource,
        properties.mavenCompilerTarget,
        properties.javaVersion,
    ];

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }

        const normalized = candidate.trim();

        if (normalized) {
            return normalized;
        }
    }

    return undefined;
}
