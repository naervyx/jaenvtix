# Scanner de `pom.xml`

## Visão geral

O módulo `scannerPom` oferece utilidades para localizar arquivos `pom.xml` em um diretório de trabalho e determinar a versão alvo de Java declarada em cada projeto Maven. Ele foi pensado para ser usado dentro da extensão VS Code, mas não depende das APIs do editor, permitindo testes unitários simples.

## API

### `scanWorkspaceForPom(workspaceRoot?: string): Promise<PomScanResult[]>`

- **Entrada**: caminho absoluto ou relativo do diretório que será percorrido. Quando omitido, utiliza o diretório atual do processo.
- **Saída**: lista ordenada alfabeticamente contendo objetos `{ path, javaVersion }`, onde `path` é o caminho absoluto do `pom.xml` encontrado e `javaVersion` é a versão deduzida (ou `undefined` caso não seja possível resolvê-la).
- **Comportamento**: percorre recursivamente o diretório informado ignorando pastas comuns que não contêm builds Maven (`.git`, `node_modules`, `target`). Para cada `pom.xml` encontrado, invoca `resolveJavaVersion`.

### `resolveJavaVersion(pomPath: string): Promise<string | undefined>`

- **Entrada**: caminho absoluto do arquivo `pom.xml` a ser analisado.
- **Saída**: versão de Java resolvida como string (ex.: `"21"`, `"1.8"`) ou `undefined` se a informação não estiver presente.
- **Comportamento**: processa o XML via parser incremental, sem carregar o documento inteiro em memória. Os valores são extraídos por ordem de prioridade:
  1. `<build><plugins><plugin>` com `<artifactId>maven-compiler-plugin</artifactId>` e elementos `<configuration><release|source|target>`;
  2. Propriedades `maven.compiler.release`, `maven.compiler.source` e `maven.compiler.target`;
  3. Propriedade `java.version`.

Se múltiplas entradas forem encontradas, a primeira na ordem acima é utilizada.

## Extensões futuras

- Resolução de propriedades encadeadas (ex.: `${maven.compiler.release}`) usando o mapa de propriedades do POM.
- Suporte a perfis Maven (`<profiles>`) que possam alterar a configuração de compilação.
- Parametrização de diretórios ignorados durante a varredura.
- Exposição de metadados adicionais, como `groupId`, `artifactId` ou identificadores de módulos.
