# Plano de testes F5 — versão inicial do caminho raster

**Estado desta subtask:** suíte escrita e revisada estaticamente; nenhum teste, SQL, processo MySQL ou worker foi executado nesta autoria. Execução, resultados, commits e limpeza são responsabilidade do principal. Arquivo exclusivo de código criado: `server/rasterInitialVersion.synthetic.test.ts`.

## Escopo e cenários

A suíte contém **sete casos sequenciais**, cada qual com timeout de 120 segundos. Apenas o primeiro realiza uma ingestão GDAL bem-sucedida; os outros usam erros reais sem reprocessar COG desnecessariamente.

1. **Sucesso real:** caller editor membro do projeto sintético; scanner local real; uma versão 1 que aponta exatamente aos bytes originais, com SHA-256, tamanho, MIME, nome, usuário e `metadata.source=raster-ingestion`. Confere `currentVersion=1`, ligação SQL arquivo/versão/camada e ausência de campos de resultado do driver nos objetos retornados. Processa COG e tiles reais com zoom 12, confere bytes/hash/chaves distintos do original, layout COG e CRS EPSG:4674 via `gdalinfo`, overviews/NoData, manifestos e assinaturas PNG. Valida `files.get`, `versions`, `download`, `downloadVersion`, versão inexistente e nega usuário pertencente somente ao outro projeto.
2. **Falha real de assinatura TIFF no worker:** bytes sintéticos aceitos pelo scanner real, mas rejeitados pelo adapter/worker com `PRECONDITION_FAILED`. Original e exatamente v1 permanecem íntegros e baixáveis; camada fica `failed` e invisível/fora de `listForMap`. O status dos metadados de arquivo é **observado e registrado, não corrigido nem exigido como failed**.
3. **Mesmo filename concorrente:** dois uploads reais de bytes sintéticos distintos e seguros ao scanner, com falha real da assinatura TIFF. Exige dois IDs, duas chaves e uma v1 por arquivo; reabre ambos os objetos depois de concluídas as duas requisições para provar ausência de sobrescrita. Não gera um segundo COG.
4. **Rollback real do driver:** trigger `geoportal_f5.f5_reject_initial_version`, `BEFORE INSERT file_versions`, executa `SIGNAL SQLSTATE '45000'` com marcador exclusivo. Exige erro da cadeia real Drizzle/mysql2, contagens de arquivos/versões/camadas/auditoria inalteradas, nenhuma alteração em artefatos raster e nenhuma referência SQL ao novo objeto. O objeto já gravado permanece explicitamente órfão. Trigger removido em `finally` e ausência verificada depois.
5. **Acesso antes da gravação:** client, editor não membro, caller não autenticado, projeto inexistente e outro projeto negados; contagens SQL, capturas de storage e árvores raster inalteradas.
6. **Malware antes da gravação:** assinatura MZ rejeitada pelo scanner real, sem storage/versão/camada/worker.
7. **Validação antes da gravação:** divergência de tamanho decodificado, tamanho declarado acima de 100 MiB, MIME não permitido e zoom invertido negados sem persistência.

## Guardas obrigatórios

A suíte usa `describe.skipIf(F5_SYNTHETIC !== '1').sequential`. Antes de abrir conexão ou executar qualquer SQL, exige raiz real sem symlink com formato `/tmp/atena-f5.*`, URL `mysql://root@127.0.0.1/geoportal_f5` sem senha e query `socketPath` exatamente `ROOT/mysql-data/mysql.sock`. O hostname permanece `127.0.0.1`, mas a conexão de observação usa **somente socket Unix**. A conexão Drizzle real usa o `DATABASE_URL` validado.

Também exige `ARQUEO_RASTER_INGESTION_MODE=direct-local`, `ARQUEO_LOCAL_RASTER_ROOT=ROOT/raster-volume`, `F5_EVIDENCE_DIR` absoluto, nenhum worker remoto/VirusTotal/credenciais externas, diretórios de objetos e raster sem symlink, schema sintético vazio, ausência inicial de triggers e tabelas transacionais InnoDB. A fixture deve existir em `ROOT/fixture/before_raw_epsg4326.tif`, ser GTiff EPSG:4326 e não COG, conforme inspeção GDAL futura durante o setup.

O runner principal deve continuar usando `env -i`, namespace de rede isolado, MySQL socket-only e nenhum ambiente real. A suíte **não cria nem migra schema**, não inicia banco e não busca rede. Faz apenas seed sintético de quatro usuários, dois projetos e três associações no schema vazio validado.

## Única substituição de boundary

`vi.mock('./storage')` é test-only e escreve os bytes efetivos sob `ROOT/objects`. O array de capturas contém somente chave, URL sintética, tamanho, MIME e hash; não guarda duplicatas de buffers. Gravação com `flag: 'wx'` faz colisões falharem em vez de esconder sobrescritas. Não há mocks de banco, Drizzle, mysql2, scanner, adapter, worker ou GDAL.

`download` e `downloadVersion` retornam referências sintéticas locais. A suíte confirma o contrato dos retornos e lê os bytes correspondentes no filesystem; **não testa HTTP, URL assinada, S3 real, OAuth ou sessão**.

## Evidências futuras

O `afterAll` fecha a conexão separada e escreve `F5_EVIDENCE_DIR/raster-initial-version-report.json` com contagens, hashes, tipos, limites, IDs e linhas exclusivamente sintéticas. Casos entram em `completedCases` somente depois de suas asserções. O JSON não substitui o resultado Vitest do runner e não deve ser apresentado como prova de sucesso se a execução falhar.

Após o caso de sucesso, preserva `F5_EVIDENCE_DIR/samples/f5-original-epsg4326.tif`, `f5-derived-epsg4674.cog.tif` e os dois `gdalinfo.json`, com hashes no relatório, para inspeção independente após a limpeza da raiz temporária. Não cria dumps de banco.

## Limite de atomicidade e hipóteses para o principal

A transação implementada pelo principal deve cobrir **arquivo + versão inicial**, após storage/scanner e antes de camada/adapter. O rollback SQL não inclui storage: o objeto previamente enviado pode sobrar e **não deve ser apagado automaticamente por este F5**. Esse risco é exercitado e reportado, não escondido como atomicidade distribuída.

A suíte independe das propriedades opcionais `response.version` e `response.versionId`; obtém os IDs reais da versão pelas rotas e consulta SQL. Não muda a semântica preexistente do status de arquivo após falha. A prova de que o worker não produziu efeito no rollback é comportamental — nenhuma camada/auditoria/alteração de artefato com fixture conhecida válida —, sem interceptar ou simular chamadas internas.

A conexão administrativa do runner precisa permitir `CREATE TRIGGER`/`DROP TRIGGER` **somente no schema local exato**; sem isso, o caso de atomicidade falhará legitimamente. O principal deve executar a suíte apenas pelo runner isolado e conferir tipos/resultados antes de declarar aprovação.
