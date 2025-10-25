# Archive Extractor Limitations

## Ferramentas nativas indisponíveis

Ambientes sem `tar`, `unzip` ou `powershell` executável dependerão exclusivamente do fallback em JavaScript, que pode ser mais lento para arquivos grandes.

## Suporte a formatos restrito

Atualmente o módulo cobre apenas `zip`, `tar` e `tar.gz`. Arquivos com compressões alternativas (por exemplo, `tar.bz2`) disparam o fluxo de erro e exigem extração manual.

## Validação de entradas

O processo de validação rejeita qualquer entrada com caracteres inválidos ou tentativas de travessia. Isso pode impedir alguns arquivos raros com nomes incomuns, exigindo intervenção manual.
