import {findProjectsWithFile} from "../../util/fileSearch";

export function findProjectsWithPom(root: string): string[] {
    return findProjectsWithFile(root, 'pom.xml');
}