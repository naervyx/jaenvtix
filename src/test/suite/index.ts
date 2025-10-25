import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Mocha from 'mocha';

async function collectTestFiles(directory: string): Promise<string[]> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const files: string[] = [];

        for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);

                if (entry.isDirectory()) {
                        files.push(...(await collectTestFiles(fullPath)));
                } else if (entry.isFile() && fullPath.endsWith('.test.js')) {
                        files.push(fullPath);
                }
        }

        return files;
}

export async function run(): Promise<void> {
        const mocha = new Mocha({ ui: 'tdd', timeout: 60_000 });
        const testsRoot = path.resolve(__dirname, '..');
        const testFiles = await collectTestFiles(testsRoot);

        for (const file of testFiles) {
                mocha.addFile(file);
        }

        await new Promise<void>((resolve, reject) => {
                try {
                        mocha.run((failures) => {
                                if (failures > 0) {
                                        reject(new Error(`${failures} tests failed.`));
                                        return;
                                }

                                resolve();
                        });
                } catch (error) {
                        reject(error);
                }
        });
}
