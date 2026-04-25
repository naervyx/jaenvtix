import {promises as fs, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {createTempDir} from './tempDir';

export interface ProjectFile {
    relativePath: string;
    content: string;
}

export async function createProject(files: ProjectFile[]): Promise<string> {
    const root = await createTempDir('jaenvtix-project-');
    for (const file of files) {
        const fullPath = join(root, file.relativePath);
        await fs.mkdir(dirname(fullPath), {recursive: true});
        writeFileSync(fullPath, file.content, 'utf-8');
    }
    return root;
}

export function pom(content: string): ProjectFile {
    return {relativePath: 'pom.xml', content};
}

export function javaSource(packagePath: string, fileName: string, content: string): ProjectFile {
    return {
        relativePath: join('src', 'main', 'java', ...packagePath.split('.'), fileName),
        content,
    };
}
