# F1/F2 — classificação GeoTIFF e compatibilidade do upload TIFF

**Data:** 02/11/2026. **Escopo:** correções incrementais e testes somente na cópia isolada, conforme autorização de 17:08 BRT. **Estado:** etapa local F1/F2 concluída para revisão: código funcional salvo, 45 testes dirigidos aprovados e harness visual encerrado com 10 cenários/91 asserções aprovados (seção 8). Não houve homologação integral nem publicação.

## 1. Identidade e preservação

| Referência | Identidade |
|---|---|
| Fonte F4 preservada | `98e7a894ddc543906031ebadadb7c92665a90bc8` (inclui código funcional F4 `ed1e6df5e539bb49561353607f41a12e00101abd`) |
| Worktree nova | `/home/ubuntu/atena_geoportal_f1f2_isolado` |
| Branch exclusivamente local | `candidato/f1f2-tiff-compat` |
| **Commit funcional F1/F2** | **`3b5e0f03160c84279671f7e764ff0dc7ce9d25a1`** |
| Baseline produtivo de comparação, não alterado | `04e64773d0c2a9b4cb25fa7f4d1015646fb11091` |

Antes da edição, foi criado e verificado um Git bundle recuperável privado local de F4. A worktree F4 e a worktree f7bf75e foram preservadas. Não houve checkpoint WebDev, push/merge, deploy ou alteração de vínculo/domínio.

Pacotes anteriores preservados, sem reempacotamento:

| Pacote histórico | SHA-256 |
|---|---|
| `ATENA_GEOPORTAL_F4_DRIVER_REAL_ed1e6df_v2_20261102.zip` | `43dfdb027b0e9cb84c2dedbea6f493339ff10b3d0da4268f909a62ac88a92769` |
| `ATENA_GEOPORTAL_REVISAO_UNICA_f7bf75e_20261102.zip` | `60f97958f22c6fd8fd35500ced18af23b9292966df80a73a6afad023954a475e` |
| `atena_geoportal_opcao_a_candidata_fcbc5aa.zip` | `4b99ade75f231c4d2a08c336696cca611b25ded23c16b4cebc70c455ea76541e` |

Este trabalho não altera esses pacotes nem transforma suas provas históricas em provas da nova versão. O complemento F1/F2 requer a base F4 identificada; não é atualização automática do stage.

## 2. Correção F1 — categorias e apresentação

Foi criada taxonomia compartilhada pura `shared/fileTypeCategories.ts`, consumida pelos dois filtros (`db.getAllFilesForUser` e `filesRouter.list`) e pela seleção de badge/ícone global em `Files.tsx`.

- `geospatial`: `kml`, `kmz`, `shp`, `geojson`, **`geotiff`**.
- `document`: `pdf`, `docx`, `xlsx`.
- `image`: `image`.
- `other`: `other`.

Os oito rótulos antigos e GeoJSON mantêm suas categorias e apresentação. A única inclusão é `geotiff` na categoria geoespacial. Um TIFF já persistido como `image` permanece `image`; nenhum registro ou enum foi convertido. Os rótulos desconhecidos preservam o fallback visual “Outro”, sem normalização automática do valor persistido. Busca, paginação, ordenação, projeção, exclusão lógica e associação de projeto foram mantidas.

Classificação do achado: **cobertura incompleta do novo fluxo**, não perda demonstrada dos rótulos antigos. O relatório F1 anexo registra diferenças, testes estáticos e hashes específicos.

## 3. Correção F2 — entrada e intenção explícita

### 3.1 Dois modos visíveis, sem fallback silencioso

No `FileUpload` padrão há um seletor TIFF/GeoTIFF:

1. **Processar como raster/COG** — permanece selecionado inicialmente para conservar a intenção da candidata raster. Exige disponibilidade raster; estado indisponível é informado antes da leitura/envio. A negativa do servidor continua autoritativa. Nenhuma falha raster dispara automaticamente upload genérico.
2. **Guardar somente o TIFF original** — escolha explícita do usuário para preservar a capacidade baseline de armazenar o original mesmo sem worker raster. Usa o endpoint genérico existente, scanner e RBAC existentes, `category: image`, `mimeType: image/tiff`. Não cria camada, COG, tiles ou georreferenciamento; a interface informa essa limitação e a mensagem de sucesso distingue armazenamento de processamento.

Para TIFFs com MIME alternativo reconhecido (`image/geotiff`, `application/geotiff`), o modo original normaliza **somente o MIME enviado ao endpoint genérico para `image/tiff`**. Nome, bytes e hash permanecem inalterados. Essa decisão mantém o contrato servidor existente e não introduz novos MIME no endpoint genérico; MIME do browser não é prova do conteúdo nem autorização para ignorar scanner. A UI deixa claro o modo “somente original”.

### 3.2 MIME e nome curto

`shared/tiffUploadPolicy.ts` é compartilhado pelo upload padrão e painel dedicado. Ambos reconhecem os três MIME TIFF; somente quando o browser não fornece MIME há inferência por `.tif/.tiff`. Um MIME não vazio conflitante não é substituído por causa da extensão. As demais allowlists e limites de tamanho continuam vigentes.

Para `a.tif`, o nome derivado da camada passa a ser **`a.tif`**, válido no contrato servidor existente de 2–255 caracteres; `filename` permanece `a.tif`. Nomes-base normais continuam sem extensão. O servidor não teve seu mínimo reduzido nem ganhou bypass. O mesmo helper é usado pelo painel dedicado.

O upload agora aguarda imediatamente a Promise para capturar rejeições rápidas e deixou de simular percentuais durante a espera. Isso é parte do tratamento de erro F2, não medição real de progresso de rede. Leitura de arquivo também trata `FileReader.onerror`. O layout, navegação, globo e demais páginas não foram substituídos.

### 3.3 Relação com baseline

- A regra genérica `image/tiff → image`, sem ingestão, é **preexistente** e foi mantida.
- O bloqueio condicional imposto pela candidata sem serviço raster foi mitigado pela **opção explícita original**, não por aprovação falsa de processamento.
- A restrição `a.tif → name: a` foi corrigida na derivação; contrato servidor inalterado.
- Os MIME alternativos, antes rejeitados na UI padrão, foram alinhados ao novo fluxo raster.
- **F5 não entra nesta rodada:** a criação da versão inicial no caminho raster permanece pendente. A versão inicial comprovada abaixo pertence ao caminho **genérico original**, não resolve F5.

## 4. Provas dirigidas — sem repetir os 112 históricos

| Verificação | Resultado | Limite |
|---|---:|---|
| Política TIFF pura | **16 casos aprovados** | Regras de MIME/modo/nome e preservação de entradas não-TIFF |
| F1 taxonomia e preservação estática | **24 casos aprovados** | Helper e ligação dos consumidores; não é teste browser da página global |
| Integração MySQL/Drizzle/mysql2, routers e scanner | **5 casos aprovados** | Banco real local; fronteira de storage substituída somente no teste por filesystem temporário |
| **Total dirigido** | **45 casos / 3 arquivos aprovados** | Não somar execuções repetidas como testes distintos |
| TypeScript | Aprovado em ambiente limpo sem rede | Será reconferido se o harness adicionar arquivos TypeScript |
| Build | Aprovado offline | Warning de chunks grandes e dependências preexistentes não equivale a erro |

O log de MySQL identifica a engine `8.0.46-0ubuntu0.24.04.4`. Usa as versões instaladas de Drizzle/mysql2 da base F4 (sem alteração de lockfile). **Não há mock de `db`, Drizzle ou mysql2.** Não se repetiu o teste de backup F4 nem a suíte histórica 112/TiDB.

### 4.1 Persistência e filtros reais

As fixtures locais possuem dez rótulos de arquivo atuais no projeto 101, outro raster no projeto 102 e raster logicamente excluído. Pelos endpoints reais:

- Filtros SQL/global e por projeto retornam exatamente as categorias esperadas, incluindo `geotiff` apenas em geoespacial.
- “Todos” mantém os dez rótulos; rótulo antigo `image` permanece em imagens.
- Busca `geotiff`, paginação e offset foram exercitados.
- Editor associado não vê arquivo de outro projeto; a listagem desse projeto é negada. Outro editor vê apenas o seu projeto. Registro logicamente excluído não aparece.

### 4.2 TIFF original e hash

Foi gerado TIFF **válido e sintético** com GDAL: 8×8, um canal, EPSG:4674. O executor salva `gdalinfo -json`, não é fixture de 49 bytes nem dado real. **Não é usado como prova de geração COG/Atlas ou backup raster.**

| Propriedade | Valor comprovado |
|---|---|
| Tamanho | 447 bytes |
| SHA-256 original e bytes salvos | `9bbcbd7a6c27c6d9067e5eb89736a62b9b98b7768ad660d1765acacc35c93b2a` |
| Nome persistido | `a.tif` |
| Rótulo / MIME SQL | `image` / `image/tiff` |
| `isGeospatial` | `false` |
| Camadas raster criadas | 0 |
| Versão inicial genérica | 1 registro, hash e tamanho idênticos |
| Auditoria | 1 `file.upload` para o arquivo |

A chamada foi feita ao `filesRouter.upload` real via tRPC caller sintético. Somente o módulo `storage` foi substituído **no arquivo de teste** por escrita real em diretório temporário. Scanner local real, validações, SQL/ORM, versionamento, auditoria e notificações locais permaneceram reais. Portanto, isso **não valida `manus-upload-file`, storage gerenciado ou autenticação OAuth**.

### 4.3 Negativas reais

Client sem papel de edição, editor de outro projeto e contexto não autenticado foram negados. Uma assinatura MZ foi rejeitada pelo scanner real antes do storage. O request raster derivado de `a.tif` ultrapassa a validação de nome e recebe a negativa real `PRECONDITION_FAILED` de disponibilidade, **sem alteração na contagem de arquivos**. Esse teste comprova validação/guardas, não processamento raster concluído.

## 5. Isolamento e cleanup

O executor `infra/scripts/run_files_f1f2_validation.sh` foi chamado em namespace de rede privado, com somente loopback e sem rota externa; recebe `env -i` e valores exclusivamente sintéticos. Não há `.env` real na worktree. O MySQL usa `--skip-networking --mysqlx=OFF`, apenas **socket Unix**. Não houve listener TCP SQL, credencial produtiva, configuração gerenciada ou leitura/escrita externa.

Um único schema novo `geoportal_f1f2` foi criado e recebeu o histórico GIS exclusivamente como bootstrap descartável do teste. **Nenhum SQL de migration foi editado e nenhum DDL foi executado em stage/produção.** Datadir, socket, TIFF e objetos temporários foram removidos; `cleanup.json` registra saída 0 e ausência dos temporários. Verificação posterior não encontrou processo mysqld correspondente.

## 6. Patch incremental, revisão e reversão

Patch funcional desde F4 `98e7a89…` até `3b5e0f0…`:

- `F1F2_INCREMENTAL_CODE.diff` — SHA-256 `18c281bb57cf348cb0c385a11ae15631434988f6a73e0113b21313709dbb55a6`.
- `F1F2_INCREMENTAL_CODE.patch` — SHA-256 `196be411984263022964b196072b2fb282d1bbf74fae3d7288d3205cb4e1cb0a`.

Ambos foram exportados sem cores/ANSI e passaram em `git apply --check` na fonte F4, **sem aplicação**. A reversão desta rodada é seleção do checkout anterior F4. Não requer down-migration nem reclassificação dos arquivos criados; o contrato antigo já lê rótulos `image`/`geotiff` com as limitações F1 anteriores. Isso não é prova integral do baseline produtivo contra schema novo ou um plano de restaurar banco por cima de escritas posteriores.

As fontes F4/f7, schema/migrations, backup F4, autenticação/sessões, storage de produção, dependências e lockfile ficaram intocados. A cadeia nova contém F4 e não o substitui silenciosamente.

## 7. Pendências e gate seguinte

- **F5:** versionamento inicial do caminho raster ainda não implementado; não confundir com a versão inicial genérica testada aqui.
- Homologação real de app/login/fluxos completos continua bloqueada pelo extrato administrativo de domínio/SHA/Auto-Publish, binding de banco do deployment, namespace/política storage e callbacks/origens OAuth.
- Storage gerenciado, upload/download remoto, raster end-to-end via UI real autenticada, globo 2D/3D, edição/exclusão persistente, Atlas e rollback integral com schema novo não foram homologados por este complemento.
- Ensaio histórico TiDB Community não certifica edição Serverless; F1/F2 não foram reensaiados nela.
- Nenhum dos 11 objetos foi dispensado, recuperado por presunção, excluído ou alterado. Atena PR8 continua preservada para fase própria.
- Nenhum deploy, publicação, DDL/seed/configuração de stage/produção, novo segredo, backup produtivo ou serviço pago foi executado.

A entrega é **candidata local para revisão**, não pronta para publicação por causa de testes locais aprovados.

---

## 8. Fechamento — harness visual concluído

A execução conclusiva `attempt-20261102T201541.889590Z-a0e7b6` passou em **10/10 cenários e 91/91 asserções DOM/payload**. O TypeScript foi validado novamente após a criação dos arquivos do harness (`tsc --noEmit --incremental false`, exit 0), sem modificação do código funcional. Os hashes dos componentes/política antes e depois foram idênticos aos arquivos do commit funcional `3b5e0f03160c84279671f7e764ff0dc7ce9d25a1`.

Foram montados diretamente `FileUpload` e `RasterIngestionPanel`, sem copiar o componente ou alterar o aplicativo. `React Query` e `tRPC Provider` são reais; o link de transporte é **mock em memória** para `raster.ingestionAvailability`, `files.upload` e `raster.ingestGeoTiff`. Não há App, OAuth, provider de login, usuário, cookie ou bypass de autenticação. Os eventos de arquivo utilizam DOM/File/DataTransfer e os controles são acionados pelo browser local.

| Cenário | Resultado |
|---|---|
| Raster indisponível bloqueia antes da mutação | PASS |
| Original explícito TIFF usa somente endpoint genérico, categoria image | PASS |
| Original `image/geotiff` normaliza para `image/tiff` | PASS |
| Original `application/geotiff` normaliza para `image/tiff` | PASS |
| Original `.tif` com MIME vazio recebe fallback delimitado | PASS |
| MIME `application/x-msdownload` recusado em original | PASS |
| Mesmo MIME conflitante recusado em raster disponível | PASS |
| `a.tif` envia nome de camada válido e mantém filename | PASS |
| Falha raster mostra erro, sem endpoint genérico nem sucesso | PASS |
| Painel dedicado real aceita `a.tif` com MIME vazio | PASS |

Os bytes `File` do browser são **13 bytes sintéticos, não GeoTIFF válido**. Servem exclusivamente à prova de roteamento/DOM. Eles são diferentes do TIFF **válido** de 447 bytes usado no ensaio MySQL. Respostas mock de processamento não geram COG/tiles; o cabeçalho visual declara isso expressamente, inclusive quando o componente real mostra mensagens de sucesso diante da resposta mock.

Rede e cleanup: namespace privado com somente lo, sem rotas IPv4/IPv6, probe direto externo recusado com `ENETUNREACH` (errno 101); Vite `127.0.0.1:4181`, CDP `127.0.0.1:9228`, `env -i`, configuração `envDir:false`, sem plugin runtime Manus, somente endpoints `.invalid`. Nenhuma requisição externa ou exceção JS não tratada observada. Processos próprios encerrados e perfil/cache temporários removidos. Não é URL de homologação acessível externamente; o harness foi encerrado após o ensaio.

Na negativa raster, também se observou que o callback existente `onUploadComplete` é invocado depois do timer de limpeza mesmo em falha. Esse callback **não foi considerado sucesso**: DOM/toast de erro e ausência de mutação genérica foram conferidos imediatamente e após 2,6 s. O erro do card transitório consta no JSON; o screenshot tardio conserva o toast. O comportamento do callback não foi alterado nem usado para fingir processamento concluído.

**Tentativa inicial preservada:** `attempt-20261102T201412.747311Z-c2fa29` teve seis cenários aprovados/50 asserções aprovadas e quatro interrupções na preparação por erro de serialização de elemento DOM do **executor CDP**. Somente o runner foi corrigido para retornar Boolean; nova tentativa integral passou. Não houve defeito do componente reproduzido nessa tentativa, e seus passes não foram adicionados aos dez cenários conclusivos.

Documentação, comandos, capturas, snapshots DOM, payloads, rede e cleanup estão em `incremental/docs/consolidation/evidence/f1f2-visual/` no pacote. O README dessa pasta e o JSON conclusivo delimitam as provas. Os **45 testes dirigidos de política/persistência** e **10 cenários/91 asserções visuais** são conjuntos diferentes; não somar como “136 testes de integração”.

**Conclusão da rodada:** F1 e os pontos F2 delimitados foram corrigidos e comprovados no escopo local especificado. F4 foi preservado, sem repetição do seu ensaio já suficiente. F5 e a homologação integral continuam pendentes; publicação permanece bloqueada.
