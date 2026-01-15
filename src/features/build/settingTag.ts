import * as fs from 'fs';
import * as path from 'path';

interface VsCodeSettings {
    "java.jdt.ls.java.home"?: string;
    "java.jdt.ls.lombokSupport.enabled"?: boolean;
    "maven.executable.preferMavenWrapper"?: boolean;
    "maven.executable.path"?: string;
    "java.compile.nullAnalysis.mode"?: string;
    "java.configuration.updateBuildConfiguration"?: string;
    "java.configuration.maven.userSettings"?: string;
    [key: string]: unknown;
}

interface JavaMavenPaths {
    javaHomePath: string;
    mavenBinPath: string;
    userSettingsPath: string;
}

interface UpdateResult {
    updated: boolean;
    addedKeys: string[];
}

/**
 * Lê um arquivo JSON de settings, valida e adiciona tags faltantes
 * @param settingsPath - Caminho para o arquivo settings.json
 * @param paths - Caminhos para Java, Maven e user settings
 * @returns Resultado da operação indicando se houve atualização e quais chaves foram adicionadas
 */
export function updateVsCodeSettings(
    settingsPath: string,
    paths: JavaMavenPaths
): UpdateResult {
    const result: UpdateResult = {
        updated: false,
        addedKeys: []
    };

    // Lê o arquivo JSON existente ou cria um objeto vazio
    let data: VsCodeSettings = {};
    
    if (fs.existsSync(settingsPath)) {
        const fileContent = fs.readFileSync(settingsPath, 'utf-8');
        try {
            data = JSON.parse(fileContent) as VsCodeSettings;
        } catch {
            console.error('Erro ao parsear o arquivo JSON, criando novo objeto');
            data = {};
        }
    }

    // Define as configurações que devem existir
    const requiredSettings: Record<string, unknown> = {
        "java.jdt.ls.java.home": paths.javaHomePath,
        "java.jdt.ls.lombokSupport.enabled": true,
        "maven.executable.preferMavenWrapper": true,
        "maven.executable.path": paths.mavenBinPath + "\\mvn.cmd",
        "java.compile.nullAnalysis.mode": "automatic",
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.configuration.maven.userSettings": paths.userSettingsPath
    };

    // Verifica cada configuração e adiciona se não existir
    for (const [key, value] of Object.entries(requiredSettings)) {
        if (!(key in data)) {
            data[key] = value;
            result.addedKeys.push(key);
            result.updated = true;
        }
    }

    // Se houve alterações, salva o arquivo
    if (result.updated) {
        // Garante que o diretório existe
        const dirPath = path.dirname(settingsPath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        
        fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4), 'utf-8');
        console.log(`Configurações adicionadas: ${result.addedKeys.join(', ')}`);
    } else {
        console.log('Todas as configurações já existem. Nenhuma alteração necessária.');
    }

    return result;
}