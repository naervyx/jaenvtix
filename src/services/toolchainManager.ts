import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';

export interface ToolchainEntry {
    version: string;
    vendor: string;
    javaHome: string;
}

interface ExistingToolchain {
    vendor?: string;
    version?: string;
    snippet: string;
}

export class ToolchainManager {
    constructor(private readonly homeDirectory: string = os.homedir()) {}

    public getDefaultPath(): string {
        return path.join(this.homeDirectory, '.m2', 'toolchains.xml');
    }

    public async ensureExists(filePath?: string): Promise<string> {
        const targetPath = filePath ?? this.getDefaultPath();
        const directory = path.dirname(targetPath);
        await fs.mkdir(directory, { recursive: true });

        try {
            await fs.access(targetPath);
            return targetPath;
        } catch {
            const initial = ['<?xml version="1.0" encoding="UTF-8"?>', '<toolchains>', '</toolchains>', ''].join('\n');
            await fs.writeFile(targetPath, initial, 'utf-8');
            return targetPath;
        }
    }

    public async mergeToolchains(entries: ToolchainEntry[], filePath?: string): Promise<void> {
        if (entries.length === 0) {
            await this.ensureExists(filePath);
            return;
        }

        const targetPath = await this.ensureExists(filePath);
        let original = await fs.readFile(targetPath, 'utf-8');
        if (!original.trim()) {
            original = ['<?xml version="1.0" encoding="UTF-8"?>', '<toolchains>', '</toolchains>', ''].join('\n');
        }

        const existing = this.extractExistingToolchains(original);
        let updated = original;

        for (const entry of entries) {
            const key = this.toKey(entry.vendor, entry.version);
            const current = existing.get(key);
            if (current) {
                const replacement = this.updateExistingSnippet(current.snippet, entry);
                updated = updated.replace(current.snippet, replacement);
                existing.set(key, { ...current, snippet: replacement });
            } else {
                const snippet = this.createSnippet(entry);
                updated = this.insertSnippet(updated, snippet);
            }
        }

        await fs.writeFile(targetPath, updated, 'utf-8');
    }

    private extractExistingToolchains(xml: string): Map<string, ExistingToolchain> {
        const map = new Map<string, ExistingToolchain>();
        const regex = /<toolchain>[\s\S]*?<\/toolchain>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const snippet = match[0];
            const vendor = this.extractTagValue(snippet, 'vendor');
            const version = this.extractTagValue(snippet, 'version');
            if (vendor && version) {
                map.set(this.toKey(vendor, version), { vendor, version, snippet });
            }
        }
        return map;
    }

    private extractTagValue(source: string, tag: string): string | undefined {
        const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'i');
        const match = regex.exec(source);
        return match ? match[1].trim() : undefined;
    }

    private updateExistingSnippet(original: string, entry: ToolchainEntry): string {
        let result = original;
        result = this.replaceOrInsertTag(result, 'vendor', entry.vendor, '<provides>');
        result = this.replaceOrInsertTag(result, 'version', entry.version, '<provides>');
        result = this.replaceOrInsertTag(result, 'jdkHome', entry.javaHome, '<configuration>', 'configuration');
        return result;
    }

    private replaceOrInsertTag(
        source: string,
        tag: string,
        value: string,
        parentOpening: string,
        parentTag = parentOpening.replace(/[<>]/g, ''),
    ): string {
        const escapedValue = this.escapeXml(value);
        const tagRegex = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'i');
        if (tagRegex.test(source)) {
            return source.replace(tagRegex, `<${tag}>${escapedValue}</${tag}>`);
        }

        const parentRegex = new RegExp(`${parentOpening}[\\s\\S]*?<\/${parentTag}>`, 'i');
        const parentMatch = parentRegex.exec(source);
        if (parentMatch) {
            const insertion = parentMatch[0].replace(
                parentOpening,
                `${parentOpening}\n    <${tag}>${escapedValue}</${tag}>`,
            );
            return source.replace(parentMatch[0], insertion);
        }

        const configurationBlock = [`  <${parentTag}>`, `    <${tag}>${escapedValue}</${tag}>`, `  </${parentTag}>`].join('\n');
        return source.replace('</toolchain>', `${configurationBlock}\n</toolchain>`);
    }

    private insertSnippet(xml: string, snippet: string): string {
        const closingIndex = xml.lastIndexOf('</toolchains>');
        if (closingIndex === -1) {
            return ['<?xml version="1.0" encoding="UTF-8"?>', '<toolchains>', snippet, '</toolchains>', ''].join('\n');
        }
        const prefix = xml.slice(0, closingIndex);
        const suffix = xml.slice(closingIndex);
        const separator = prefix.endsWith('\n') ? '' : '\n';
        return `${prefix}${separator}${snippet}\n${suffix}`;
    }

    private createSnippet(entry: ToolchainEntry): string {
        const vendor = this.escapeXml(entry.vendor);
        const version = this.escapeXml(entry.version);
        const javaHome = this.escapeXml(entry.javaHome);
        return [
            '  <toolchain>',
            '    <type>jdk</type>',
            '    <provides>',
            `      <vendor>${vendor}</vendor>`,
            `      <version>${version}</version>`,
            '    </provides>',
            '    <configuration>',
            `      <jdkHome>${javaHome}</jdkHome>`,
            '    </configuration>',
            '  </toolchain>',
        ].join('\n');
    }

    private toKey(vendor: string, version: string): string {
        return `${vendor.toLowerCase()}::${version.toLowerCase()}`;
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}
