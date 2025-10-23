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
        try {
            const raw = await fs.readFile(settingsPath, 'utf-8');
            data = JSON.parse(raw);
        } catch {
            data = {};
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
