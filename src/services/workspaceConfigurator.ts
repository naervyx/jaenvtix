import * as path from 'path';
import { promises as fs } from 'fs';

export interface WorkspaceConfigurationOptions {
    workspaceRoot: string;
    javaHome: string;
    release: string;
    vendor: string;
    mavenExecutable: string;
    toolchainsPath: string;
}

export class WorkspaceConfigurator {
    public async apply(options: WorkspaceConfigurationOptions): Promise<void> {
        const settingsPath = path.join(options.workspaceRoot, '.vscode', 'settings.json');
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });

        let data: Record<string, unknown> = {};
        let existingContent: string | undefined;
        try {
            existingContent = await fs.readFile(settingsPath, 'utf-8');
        } catch {
            existingContent = undefined;
        }

        if (existingContent !== undefined) {
            try {
                data = parseJsonWithComments(existingContent);
            } catch {
                // The existing settings file contains content that we cannot safely parse.
                // To avoid wiping user configuration, leave the file untouched.
                return;
            }
        }

        const mavenExecutable = await this.resolveMavenExecutable(options.workspaceRoot, options.mavenExecutable);
        data['maven.executable.path'] = mavenExecutable;
        data['maven.terminal.useJavaHome'] = true;

        data['jaenvtix.javaHome'] = options.javaHome;
        data['jaenvtix.release'] = options.release;
        data['jaenvtix.vendor'] = options.vendor;
        data['jaenvtix.mavenExecutable'] = mavenExecutable;
        data['jaenvtix.toolchainsPath'] = options.toolchainsPath;

        const serialized = JSON.stringify(data, null, 4) + '\n';
        await fs.writeFile(settingsPath, serialized, 'utf-8');
    }

    private async resolveMavenExecutable(workspaceRoot: string, fallback: string): Promise<string> {
        const candidates = ['mvnw', 'mvnw.cmd', 'mvnw.bat'];
        for (const candidate of candidates) {
            const candidatePath = path.join(workspaceRoot, candidate);
            try {
                await fs.access(candidatePath);
                return candidatePath;
            } catch {
                // Ignore missing wrapper
            }
        }
        return fallback;
    }
}

function parseJsonWithComments(raw: string): Record<string, unknown> {
    const sanitized = sanitizeJsonWithComments(raw);
    if (sanitized.trim() === '') {
        return {};
    }

    const parsed = JSON.parse(sanitized);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected settings.json to contain a JSON object.');
    }

    return parsed as Record<string, unknown>;
}

function sanitizeJsonWithComments(raw: string): string {
    const withoutBom = raw.replace(/^\uFEFF/, '');
    const withoutComments = stripJsonComments(withoutBom);
    return removeTrailingCommas(withoutComments);
}

function stripJsonComments(text: string): string {
    const result: string[] = [];
    let inString = false;
    let stringDelimiter: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (char === '\n' || char === '\r') {
                inLineComment = false;
                result.push(char);
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            result.push(char);
            if (char === '\\') {
                if (i + 1 < text.length) {
                    result.push(text[++i]);
                }
                continue;
            }

            if (char === stringDelimiter) {
                inString = false;
                stringDelimiter = null;
            }
            continue;
        }

        if (char === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            stringDelimiter = char;
            result.push(char);
            continue;
        }

        result.push(char);
    }

    return result.join('');
}

function removeTrailingCommas(text: string): string {
    const chars = text.split('');
    let inString = false;
    let stringDelimiter: string | null = null;

    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];

        if (inString) {
            if (char === '\\') {
                i++;
            } else if (char === stringDelimiter) {
                inString = false;
                stringDelimiter = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            stringDelimiter = char;
            continue;
        }

        if (char === '}' || char === ']') {
            let j = i - 1;
            while (j >= 0 && /\s/.test(chars[j] ?? '')) {
                j--;
            }

            if (j >= 0 && chars[j] === ',') {
                chars[j] = '';
            }
        }
    }

    return chars.join('');
}
