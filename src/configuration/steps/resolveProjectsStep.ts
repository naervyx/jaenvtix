import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../types';
import {Messages} from '../../util/message';
import {findProjectsWithFile} from '../../util/fileSearch';
import {parseJavaVersionFromPom} from '../../search/javaVersion';

export class ResolveProjectsStep implements ConfigurationStep {
    readonly name = 'ResolveProjects';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (!state.workspaceFolder) {
            return StepResult.error(Messages.Error.WORKSPACE_FOLDER_NOT_RESOLVED);
        }

        const projects = findProjectsWithFile(state.workspaceFolder, 'pom.xml');
        if (projects.length === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_POM);
        }

        state.projectVersionMap.clear();

        for (const project of projects) {
            const javaVersion = parseJavaVersionFromPom(project);
            if (!javaVersion) {
                continue;
            }

            const projectList = state.projectVersionMap.get(javaVersion) ?? [];
            projectList.push(project);
            state.projectVersionMap.set(javaVersion, projectList);
        }

        if (state.projectVersionMap.size === 0) {
            return StepResult.warning(Messages.Warning.NOT_FOUND_JAVA_VERSION);
        }

        return StepResult.success();
    }
}
