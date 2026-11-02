# TiDB 8.5.3 local — ensaio concluído, sem escrita externa

O ensaio executou o SQL GIS literal `0000–0013` em **TiDB Community `8.0.11-TiDB-v8.5.3`**, com TiKV/PD locais no sandbox e somente fixtures sintéticas. **31 arquivos / 112 testes passaram**, incluindo os 33 testes de persistência da matriz vigente. O journal oficial Drizzle foi validado separadamente na mesma instância: 14 entradas com hashes exatos. Nenhuma migration, código da aplicação, produção ou stage foi alterado para obter esses resultados.

**Código ensaiado:** `57f6a07fd573a256eaed2905c0655effa5971d19`. Os scripts e dossiês complementares desta rodada não mudam os fontes funcionais desse commit. A candidata funcional anterior `5fa06ac2f2fd544c541fc3f02969b9fd551ee1b3` e o pacote histórico `fcbc5aa35805c8f1cb8f5a394a91bad0c5161a58` permanecem preservados; o teste TiDB desta rodada não foi executado em checkout literal `5fa06ac`.

## Operações executadas

TiUP foi preparado em diretórios novos de `/tmp`, com `HOME` e `TIUP_HOME` temporários, sem modificar perfis globais. A arquitetura efetiva é **Linux ARM64/aarch64**, não AMD64. O mirror oficial forneceu componentes `v8.5.3`; não houve Docker, conta cloud, serviço pago, credencial real ou dump.

A primeira espera de prontidão do executor incluiu o tempo de download e expirou antes de o TiDB iniciar. Esse wrapper terminou com código 10 e registro `migrationStatus=not-run`. **Esse resultado foi preservado** em `evidence/tidb-8.5.3-local-run-1/report.json`; ele não deve ser apresentado como teste aprovado.

Os componentes terminaram de baixar e a mesma instância acabou iniciando. Não foi reinstalada. A inspeção mostrou SQL em `127.0.0.1:34000`, mas HTTP de status em `0.0.0.0:10080`. O TiDB temporário foi relançado com o flag oficial `--status-host=127.0.0.1`, preservando TiKV/PD, antes de executar qualquer SQL candidato. Nenhum Preview, login ou teste HTTP externo foi aberto. O bind inicial não é omitido nem apresentado como se nunca tivesse ocorrido.

O SQL literal foi aplicado em `geoportal_tidb_synthetic`; o runner registrou cada migration, SHA256 e quantidade de statements. Depois, carregou três usuários sintéticos e executou a suíte. O contrato OGC de 1000 caracteres foi exercitado pela suíte com persistência local; não houve truncamento nem redução de limite.

Dois ensaios complementares distinguiram hipóteses não provadas pelo schema vazio. Em `geoportal_tidb_enum_probe`, os oito rótulos do enum baseline já estavam persistidos antes de `0008 → 0009`. Todos foram preservados e os dois tipos novos foram aceitos. Os números retornados por `fileType+0` mudaram: consumidores numéricos não podem assumir ordinal estável. Em `geoportal_tidb_drizzle_synthetic`, `pnpm drizzle-kit migrate` passou e `__drizzle_migrations` retornou 14 hashes idênticos aos arquivos fonte.

## Evidências definitivas

- `evidence/tidb-8.5.3-local-literal-1/report.json`: 14 migrations aprovadas e suíte aprovada; `version=8.0.11-TiDB-v8.5.3`.
- `evidence/tidb-8.5.3-local-literal-1/vitest.log`: 31 arquivos / 112 testes; duração registrada de 14,66 segundos para essa suíte, não para instalação ou migrations.
- `evidence/tidb-8.5.3-local-enum-journal-1/report.json`: preservação de oito rótulos, persistência dos novos tipos e journal aprovado.
- `evidence/tidb-8.5.3-local-enum-journal-1/enum-before-after.json`: valores/ordinais exclusivamente sintéticos.
- `evidence/tidb-8.5.3-local-enum-journal-1/journal.json`: hashes e timestamps do journal sintético.
- `evidence/tidb-8.5.3-local-run-1/runtime-diagnostic.json`: primeiro timeout, bind inicial, correção e cleanup concluído; nenhum processo temporário remanescente.

Os schemas e bytes de dados locais foram descartados com o datadir. Os diretórios `/tmp/atena-tidb-853.M5L5c8` e `/tmp/atena-tidb85-local` foram removidos depois de encerrar seus processos. A verificação confirmou zero processos temporários remanescentes e nenhuma porta TiDB/TiKV/PD ativa. Evidências e material de diagnóstico foram preservados no projeto isolado; nenhum objeto ou fonte preexistente foi excluído.

## Reprodutibilidade e limites dos scripts

`infra/scripts/validate_running_local_tidb_853.mjs` executou o lote literal contra host/porta fixos locais, sem usar `DATABASE_URL` herdada, e recusou schema já existente. `infra/scripts/validate_local_tidb_853_enum_journal.mjs` executou as duas provas complementares. Ambos foram efetivamente exercitados.

`infra/scripts/run_local_tidb_853_validation.sh` foi corrigido após o incidente: download prévio com prazo separado, `--without-monitor`, wrapper que impõe `--status-host=127.0.0.1`, recusa de portas ocupadas/evidência existente, progresso periódico e cleanup limitado do grupo de processos. `bash -n` e `node --check` passaram. **O bootstrap completo revisado não foi reexecutado**, evitando novo download/instalação; sua validação foi estática, enquanto os runners de SQL, suíte, enum e journal foram exercitados no runtime existente.

## O que este resultado não comprova

TiUP Playground é uma solução oficial para cluster local de teste, não uma reprodução integral de produção ou de TiDB Cloud Serverless. Sem `--tag`, seus dados são efêmeros. O engine Community observado não tem o sufixo `serverless`. A edição gerenciada possui políticas de conexão, limites, upgrades e recursos operacionais próprios; o ensaio não demonstra igualdade de patches, permissões DDL, custo/quotas, locks/reorg sob volume, filas do tenant ou binding do deployment. [1] [2] [3] [4]

A dúvida de aceitação local de `0008`/`0009` foi superada por execução, não apenas por leitura documental. A documentação da família v8.5 registra mudanças/correções relacionadas a ENUM, mas não substitui a prova específica realizada. [5]

Não houve E2E autenticado, callback OAuth real, teste de MFA, globo 3D, storage gerenciado, WMS/WFS externo ou homologação integral. Não foi comprovado rollback do aplicativo baseline completo sobre schema novo; preservação de rótulos não equivale a esse teste. Defaults em linhas históricas, concorrência e carga real também continuam fora do ensaio.

**Nenhum DDL de produção/stage, publicação, segredo, escrita remota, dispensa dos 11 objetos ou repetição de backup produtivo foi executado. Não se pede DDL de stage para realizar este ensaio local, pois ele foi viável e concluído.**

**References**

[1]: https://docs.pingcap.com/tidb/stable/tiup-playground/ "Quickly Deploy a Local TiDB Cluster"
[2]: https://docs.pingcap.com/tidb/stable/quick-start-with-tidb/ "Quick Start with TiDB Self-Managed"
[3]: https://docs.pingcap.com/tidb/stable/tiup-overview/ "TiUP Overview"
[4]: https://docs.pingcap.com/tidbcloud/serverless-limitations/ "Limitations and Quotas of TiDB Cloud Starter and Essential"
[5]: https://docs.pingcap.com/tidb/stable/release-8.5.0/ "TiDB 8.5.0 Release Notes"
