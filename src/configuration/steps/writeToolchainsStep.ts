import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {ConfigurationStep, ConfigurationStepResult, JavaConfigurationState, StepResult} from '../../core/types';
import {Messages} from '../../util/message';
import {log} from '../../util/logger';
import {buildDefaultM2ToolchainsPath} from '../../build/directory';
import {mergeToolchainsXml, parseJdkVendor, ToolchainEntry} from '../../build/toolchainsXml';
import {toMavenToolchainVersion} from '../../util/javaVersion';

function readReleaseFile(jdkHome: string): string {
    try {
        return readFileSync(join(jdkHome, 'release'), 'utf-8');
    } catch {
        return '';
    }
}

/**
 * Writes/updates `~/.m2/toolchains.xml` with one `<toolchain>` per JDK staged
 * in this run, so any project that opts into `maven-toolchains-plugin` can
 * resolve a JDK without manual configuration. Existing toolchains the user
 * authored are preserved.
 */
export class WriteToolchainsStep implements ConfigurationStep {
    readonly name = 'WriteToolchains';

    async run(state: JavaConfigurationState): Promise<ConfigurationStepResult> {
        if (state.versionPaths.size === 0) {
            return StepResult.success();
        }

        const candidates: ToolchainEntry[] = [];
        for (const [version, paths] of state.versionPaths) {
            const releaseContent = readReleaseFile(paths.jdkHome);
            const vendor = parseJdkVendor(releaseContent);
            candidates.push({
                vendor,
                version: toMavenToolchainVersion(version),
                jdkHome: paths.jdkHome,
            });
        }

        const toolchainsPath = buildDefaultM2ToolchainsPath();
        const existingXml = existsSync(toolchainsPath) ? readFileSync(toolchainsPath, 'utf-8') : '';

        const {xml, updated} = mergeToolchainsXml(existingXml, candidates);

        if (!updated && existsSync(toolchainsPath)) {
            return StepResult.success();
        }

        const dir = dirname(toolchainsPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }

        writeFileSync(toolchainsPath, xml, 'utf-8');
        log(Messages.Log.TOOLCHAINS_XML_WRITTEN(toolchainsPath));
        return StepResult.success();
    }
}
