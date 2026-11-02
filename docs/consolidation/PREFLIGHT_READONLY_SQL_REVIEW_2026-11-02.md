# Preflight somente leitura e revisão SQL — Opção A

**Data:** 02 de novembro de 2026
**Escopo:** schema, journal e compatibilidade da candidata GIS `0007`–`0013`.
**Proibições respeitadas:** nenhum DDL, DML, seed, migration, lock explícito, `SET`, alteração de sessão, configuração, segredo, usuário, permissão, storage, homologação ou publicação.

## 1. Destino e método de preflight

O preflight consultou exclusivamente o recurso WebDev do Portal Geoespacial Corporativo (`portal_geoespacial_arqueo`), associado ao checkpoint produtivo `04e64773d0c2a9b4cb25fa7f4d1015646fb11091`.

| Evidência | Resultado |
|---|---|
| Schema retornado pelo servidor | `jXb8CWGPzwHDiFUp7FkPz8` |
| Engine/version retornada | `8.0.11-TiDB-v8.5.3-serverless` |
| Instruções emitidas | Apenas `SELECT` contra `information_schema`, `DATABASE()`, variáveis de leitura e `__drizzle_migrations` |
| Leitura de registros de negócio | Não realizada |
| DDL/DML/locks/`SET` | Não realizados |
| `@@transaction_read_only` observado | `0` |

`@@transaction_read_only = 0` significa que a conexão padrão não é tecnicamente imposta como read-only pelo servidor. Esta rodada, porém, emitiu somente consultas `SELECT`; nenhuma instrução de escrita ou alteração de sessão foi enviada. Para um futuro preflight com garantia de infraestrutura, seria necessário um perfil/conexão read-only fornecido pela plataforma — não se deve usar `SET TRANSACTION READ ONLY` sem autorização porque isso altera a sessão.

## 2. Journal: compatibilidade do baseline

O journal de produção contém sete entradas. Seus hashes correspondem byte a byte às migrations locais `0000`–`0006` da candidata:

| Ordem local | Migration | SHA-256 local e no journal |
|---:|---|---|
| 0000 | `0000_late_doctor_strange.sql` | `814a08e40d7fc2bcfd458759d18319198ca8ae394f2fa15617a78678e9c9c93b` |
| 0001 | `0001_premium_blockbuster.sql` | `480f19e28e4b00a6dcf5c76af88530a1affc59716b17cdc944793e63f69c18d9` |
| 0002 | `0002_large_blade.sql` | `291d20aed0a525627a97e65ce55d4d17ce67335a729cc75166391b6cba004a5c` |
| 0003 | `0003_safe_black_cat.sql` | `6a567de1adf22df59d6b7b181d3edfc218e0d070c2020da292514f3e3ef8e9f1` |
| 0004 | `0004_illegal_mathemanic.sql` | `0918680c5e672ea6ed239ab7fb15aa48b34cc51ef32b11f48faf765fdac882da` |
| 0005 | `0005_brief_red_shift.sql` | `8a3779cc9468e124e29f76950cc6c09658620dc99e505d9f79a7a114b98546c8` |
| 0006 | `0006_same_the_spike.sql` | `01debf59779da5f2dda231624f875101449732fc1383a6fb3a0b93c2f3fa495c` |

**Conclusão:** o baseline técnico real é compatível com a sequência GIS a partir de `0007`. As migrations PR8 homônimas `0007`–`0012` não fazem parte deste journal e continuam proibidas como lote direto por colisão de número e semântica.

## 3. Comparação atual → alvo GIS

| Migration | Estado atual confirmado somente por metadados | Alvo / efeito | Dados, defaults e índices | Risco e condição futura |
|---|---|---|---|---|
| `0007_lonely_freak.sql` | `ogc_services` e `ogc_catalog_variants` não existem. | Cria ambas as tabelas. `endpoint VARCHAR(1000)` e `endpointHash VARCHAR(64)` único. | Sem backfill, pois não há tabela existente. Cria `ogc_layer_priority_unique`, `ogc_endpoint_hash_unique`, `ogc_variant_service_idx` e `ogc_status_idx`. | DDL aditivo. Ainda assim requer validação TiDB e janela; não há FK declarada no SQL para `serviceId`/`createdBy`. |
| `0008_early_pyro.sql` | `files.fileType` atual: `enum('kml','kmz','shp','pdf','docx','xlsx','image','other') NOT NULL`. | Amplia temporariamente para incluir `geotiff`. | Os valores atuais continuam válidos; altera apenas a definição enum. | `ALTER TABLE`; pode aguardar metadata lock/reorganização. Deve manter a ordem do journal. |
| `0009_quiet_runaways.sql` | Resultado esperado após `0008`. | Enum final acrescenta `geojson` e preserva `geotiff`. | Sem default; registros existentes conservam valores permitidos. | Segundo `ALTER TABLE` seguido na mesma tabela; avaliar janela e comportamento TiDB antes de DDL. |
| `0010_lethal_expediter.sql` | `file_versions` existe; `sha256`, `mimeType` e `metadata` não existem. | Adiciona as três colunas. | Todas são anuláveis, sem default; versões existentes permanecem legíveis sem backfill. | `ALTER TABLE`; validar tempo/metadata lock. É o ponto seguro para backfill futuro separado, se aprovado. |
| `0011_abandoned_wraith.sql` | `base_layers` existe; as três colunas de backoff não existem. | Adiciona `refreshFailureCount DEFAULT 0 NOT NULL`, `lastRefreshAttemptAt`, `retryAfter`. | As linhas existentes recebem semântica de contador `0`; timestamps são anuláveis. Cache, URLs e camadas não são alterados por SQL. | `ALTER TABLE`; risco de lock/reorganização. Não executar durante atualização de camadas. |
| `0012_curved_justice.sql` | `atlas_jobs` existe; `templateId` e `renderConfig` não existem. `atlas_templates` não existe. | Cria `atlas_templates`; adiciona duas colunas anuláveis a `atlas_jobs`; cria índice `project_idx`. | Sem seed. Jobs existentes mantêm os campos novos como `NULL`; templates exigirão criação posterior pelo fluxo autorizado. | `CREATE TABLE` + `ALTER TABLE`; suspender geração de Atlas na janela. |
| `0013_glamorous_betty_brant.sql` | `backup_inventories` e `backup_policies` não existem. | Cria ambas e os índices `backup_inventory_expiry_idx(status, expiresAt)` e `backup_inventory_created_idx(createdAt)`. | Não copia bytes, não cria backup e não insere política. Defaults: policy desabilitada, intervalo 24 h, retenção 30 dias. | DDL aditivo. Não resolve nem altera os 11 objetos legados. |

## 4. SQL literal e hashes da candidata

O SQL integral está no documento [`SQL_GIS_RECONCILIADO_0007_0013_OPCAO_A.md`](SQL_GIS_RECONCILIADO_0007_0013_OPCAO_A.md). Os hashes do conteúdo efetivamente aplicado no ensaio MySQL sintético são:

| Arquivo | SHA-256 |
|---|---|
| `0007_lonely_freak.sql` | `78556354f5abc173227ea056390b7928cd3049762b2fc331cfebf5f5c1b271ab` |
| `0008_early_pyro.sql` | `43e72dec9ef9157aab79754e234fd25f1b444a0a5d3745eb87bda52c07b0b4c6` |
| `0009_quiet_runaways.sql` | `831b9fa381b131345d78190b971db94d8fa2a0982482b2edd002eaef0e70712a` |
| `0010_lethal_expediter.sql` | `f03665b58bf3a49e6f200375f307453f08c1de3382927c53385b192cc2b64ed1` |
| `0011_abandoned_wraith.sql` | `b904455fb078de6c1663b3c99d7d829fd52ab9275e5898987046e63aaea85b68` |
| `0012_curved_justice.sql` | `26d483a173339fea0cc9d52ddadb86a6d503677bcbb39ce7f2af8d71a723dd15` |
| `0013_glamorous_betty_brant.sql` | `0cc30c755839926326b98de502e2fe4f6cca9e54e92b421b27ebff7f3b857c3d` |

## 5. Compatibilidade e rollback

1. O ensaio aprovado ocorreu em **MySQL 8 local descartável**, não em TiDB. A sintaxe foi aceita pelo MySQL; antes de qualquer DDL, é necessária validação de compatibilidade e tempo/lock no ambiente isolado de mesma família/versão da produção.
2. DDL MySQL/TiDB não oferece rollback transacional global para uma sequência parcialmente aplicada. Não há plano de `DROP` automático, truncamento ou restauração destrutiva.
3. O rollback operacional previsto para falha após migrations aditivas é retornar apenas o código a uma versão anterior compatível, mantendo o schema novo e todas as escritas posteriores.
4. Caso algum ambiente já tenha aplicado uma variante histórica de `0007` sem `endpointHash`, **não se edita a migration histórica**. Deve-se emitir migration posterior aditiva, detectar duplicidade/colisão, fazer backfill controlado e só então criar o índice único.
5. As migrations Atena PR8 `0007`–`0012` não devem ser usadas neste lote. A fase Atena exigirá migrations novas com numeração posterior ao journal GIS e reconciliação de modelos.

### Atualização: análise TiDB 8.5.3

A análise documental inicialmente não comprovava `0008`/`0009`. Em 02/11, a execução local descartável em **TiDB Community `8.0.11-TiDB-v8.5.3`** aprovou o SQL literal `0000–0013`, o migrador Drizzle e seu journal de 14 hashes. A suíte do checkout `57f6a07fd573a256eaed2905c0655effa5971d19` aprovou 31 arquivos / 112 testes. Outro schema sintético preservou os oito rótulos antigos de `files.fileType` após `0008 → 0009`, aceitando também `geotiff`/`geojson`; ordinais numéricos mudam. Nenhuma migration foi modificada. Isso supera a pendência de aceitação local, **não certifica Serverless, volume/locks reais ou rollback completo de código**. Evidências e limites em `ENSAIO_LOCAL_TIDB_8_5_3_SERVERLESS_LIMITES_2026-11-02.md`.

## 6. Homologação funcional: requisito concreto

A homologação integral **não foi iniciada**, porque os quatro componentes isolados simultaneamente ainda não estão comprovados sem alterar configuração:

| Componente | Estado atual | Requisito mínimo para iniciar |
|---|---|---|
| Aplicação | Código pode rodar localmente; o preview atual é do projeto de referência, não desta candidata completa. | Checkout candidato executado em processo/URL isolado, identificado pelo SHA e sem apontar para domínio produtivo. |
| Banco | Script cria MySQL local descartável com fixtures sintéticas, mas não é uma homologação navegável persistente. | Banco isolado com schema aplicado apenas após aprovação, dados sintéticos e `DATABASE_URL` comprovadamente distinto do schema `jXb8CWGPzwHDiFUp7FkPz8`. |
| Storage | `storagePut` usa helper gerenciado; `storageGet` por chave não é suportado pelo adaptador atual. | Adaptador/namespace de storage com destino isolado comprovado e políticas de leitura/escrita para objetos sintéticos, sem bucket/objeto produtivo. |
| OAuth/autenticação | O ensaio define URLs `.invalid`; não houve callback real. | Aplicação OAuth de homologação, redirect URL isolada e credenciais gerenciadas já provisionadas pela plataforma, sem expor ou alterar segredos produtivos. |

Nenhum serviço pago, segredo novo ou mudança de configuração é proposta por este relatório. Enquanto esses pré-requisitos não existirem, continuam possíveis apenas testes locais sem browser autenticado e sem storage remoto, que não equivalem a homologação funcional.

## 7. Reexecução literal no commit funcional

Para eliminar ambiguidade de proveniência, a validação foi repetida em worktree temporária fixada no commit funcional `5fa06ac2f2fd544c541fc3f02969b9fd551ee1b3`, usando MySQL 8 local descartável em loopback/porta 33128. Resultado: journal `0000`–`0013` aplicado, `31` arquivos/`112` testes aprovados. A evidência em `docs/consolidation/evidence/synthetic-db-run-7-5fa/` registra explicitamente `productionTouched=false`, `homologationTouched=false`, `storageRemoteTouched=false` e `rawDataIncluded=false`.

## 8. Próximo gate

O ensaio de compatibilidade TiDB local foi viável e concluído; não é necessário pedir DDL de stage para realizá-lo. O próximo gate de leitura é a ficha segura do stage com domínio/SHA/Auto-Publish, binding de banco do deployment, namespace proprietário de storage e callbacks/origens OAuth. A evidência proprietária de 11:56 BRT foi incorporada em `INVENTARIO_READONLY_STAGE_WDP_099CA88466E2DC80D1D4FBC9_2026-11-02.md`, inclusive a ressalva `GET env → runtime_sync=applied` (sincronização automática local). O Portal GIS não repetiu essa consulta. Este documento não autoriza DDL de produção/stage, seeds remotos, publicação, backup produtivo repetido, dispensa dos 11 objetos ou mudança de configuração.
