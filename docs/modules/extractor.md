# Archive Extractor

## Overview

O módulo `extractor` processa arquivos compactados (ZIP e variantes TAR) e materializa seus conteúdos no destino indicado. Ele prefere ferramentas nativas como `unzip` e `tar` quando disponíveis, mas possui uma implementação totalmente em TypeScript como fallback, incluindo uma opção manual que solicita ao usuário uma pasta previamente extraída.

## API

### `extract(archivePath: string, destination: string, formatHint?: string): Promise<string>`

- **Entrada**:
  - `archivePath`: caminho absoluto para o arquivo compactado.
  - `destination`: pasta que deve receber os arquivos extraídos. Criada automaticamente caso não exista.
  - `formatHint`: dica opcional para forçar o formato (`"zip"`, `"tar"`, `"tar.gz"`).
- **Saída**: resolve com o caminho do destino assim que algum fluxo de extração concluir com sucesso.
- **Comportamento**:
  - Detecta o formato automaticamente quando nenhuma dica é fornecida.
  - Garante que o diretório de destino exista e delega a extração a três estratégias em cascata: nativa, fallback JavaScript e prompt manual.
  - Armazena resultados intermediários em subdiretórios temporários e move os arquivos validados para o destino final, preservando conteúdos pré-existentes que não colidam com o que está sendo extraído.
  - Valida nomes de entradas antes de acionar ferramentas nativas para bloquear caminhos absolutos ou sequências `..` que escapem do diretório de destino.

## Estratégias de Extração

### Extração nativa

- Usa `tar` ou `unzip` no macOS/Linux e `tar`/`Expand-Archive` no Windows.
- Cria um workspace temporário dentro do destino para executar a ferramenta do sistema e, após o sucesso, move o resultado validado para a pasta final.
- Rejeita entradas com caminhos suspeitos antes de invocar o binário nativo.

### Extração em JavaScript

- Implementa leitura direta do formato ZIP e um pipeline de TAR/TAR.GZ em TypeScript.
- Utiliza os mesmos diretórios temporários e verificações de caminho, minimizando riscos de sobrescrever arquivos fora da pasta alvo.

### Prompt manual

- Quando todas as estratégias automatizadas falham, solicita ao usuário (via VS Code) que selecione manualmente uma pasta já extraída.
- Normaliza e valida o caminho retornado antes de concluir a operação.

## Diretrizes de Integração

- Prefira fornecer um `formatHint` quando o formato já é conhecido para evitar heurísticas baseadas em extensão.
- Permita que os usuários escolham entre ferramentas nativas ou fallback somente JavaScript através de configurações, caso desejado.
- Capture e registre as mensagens de erro retornadas em `AggregateError` para facilitar diagnósticos de falhas.
- Garanta permissões de escrita na pasta de destino e em seus subdiretórios temporários durante a execução do módulo.

## Recursos Relacionados

- `src/modules/extractor/index.ts`: implementação principal do módulo.
- `setSpawnImplementation` / `setManualExtractionPrompt`: pontos de injeção úteis para testes automatizados.
