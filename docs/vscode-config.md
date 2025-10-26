# VS Code Workspace Configuration

Jaenvtix gerencia um subconjunto de chaves em `.vscode/settings.json` para alinhar a experiência do workspace com as ferramentas provisionadas. Essas chaves são atualizadas pela função `updateWorkspaceSettings` do módulo `vscodeConfig` e seguem as regras abaixo:

| Chave | Valor controlado | Motivo |
| --- | --- | --- |
| `java.jdt.ls.java.home` | Caminho absoluto do JDK provisionado. | Garante que o Language Server Java utilize o `JAVA_HOME` escolhido pela extensão. |
| `maven.executable.path` | Caminho para o wrapper `mvn-jaenvtix`. | Direciona o VS Code para o Maven acoplado ao JDK provisionado. |
| `maven.terminal.useJavaHome` | Sempre `true`. | Instrui o plugin de Maven a reutilizar o `JAVA_HOME` configurado, mantendo compilação/execução consistentes. |

Somente essas chaves são modificadas; qualquer configuração adicional presente em `settings.json` permanece intacta. As atualizações são idempotentes: executar o merge múltiplas vezes com as mesmas informações de toolchain mantém o arquivo byte a byte.
