import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function findProjectsWithFile(root: string, fileName: string): string[] {
    const projects: string[] = [];

    const rootFile = join(root, fileName);
    if (existsSync(rootFile)) {
        projects.push(root);
    }

    const children = readdirSync(root, { withFileTypes: true });
    for (const child of children) {
        if (child.isDirectory()) {
            const childPath = join(root, child.name);
            const file = join(childPath, fileName);
            if (existsSync(file)) {
                projects.push(childPath);
            }
        }
    }

    return projects;
}