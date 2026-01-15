import {findProjectsWithFile} from "../../util/fileSearch";

export function findProjectsWithSetting(root: string): string[] {
    return findProjectsWithFile(root, 'settings.json');
}