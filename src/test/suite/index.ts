import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20000 });
    const testsRoot = path.resolve(__dirname);

    const testFiles: string[] = [];
    const collectTests = (folder: string) => {
        for (const entry of fs.readdirSync(folder)) {
            const fullPath = path.join(folder, entry);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                collectTests(fullPath);
            } else if (entry.endsWith('.test.js')) {
                testFiles.push(fullPath);
            }
        }
    };

    collectTests(testsRoot);

    for (const file of testFiles) {
        mocha.addFile(file);
    }

    return new Promise((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
