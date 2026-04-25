import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTempDir(prefix = 'jaenvtix-test-'): Promise<string> {
    return await fs.mkdtemp(join(tmpdir(), prefix));
}

export async function writeTempFile(dir: string, name: string, content: Buffer): Promise<string> {
    const filePath = join(dir, name);
    await fs.writeFile(filePath, content);
    return filePath;
}

export async function removeTempDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
}
