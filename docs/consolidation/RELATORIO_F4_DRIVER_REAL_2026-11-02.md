# F4 — exportador de backup com Drizzle/mysql2 reais

**Data:** 02/11/2026. **Estado:** reproduzido e corrigido somente em worktree isolada. Publicação continua bloqueada.

## 1. Identidade, proteção e escopo

| Papel | Referência |
|---|---|
| Fonte preservada | `f7bf75e8b25a1c6a55edea6281327dafcc310e5b` |
| Worktree original, não alterada | `/home/ubuntu/atena_geoportal_opcao_a_isolado` |
| Worktree F4 separada | `/home/ubuntu/atena_geoportal_f4_isolado` |
| Branch exclusivamente local | `candidato/f4-driver-export` |
| Commit funcional F4 | `ed1e6df5e539bb49561353607f41a12e00101abd` |
| Pacote anterior preservado | `ATENA_GEOPORTAL_REVISAO_UNICA_f7bf75e_20261102.zip` |
| SHA-256 do pacote anterior | `60f97958f22c6fd8fd35500ced18af23b9292966df80a73a6afad023954a475e` |

Antes de editar, foi criado e verificado um Git bundle privado local do ponto `f7bf75e`; ele não é entregue, pois contém histórico e não é necessário ao patch. Foi criada worktree separada, sem sobrescrever candidata, baseline, produção, homologação ou fontes PR8. Nenhum push, merge, deploy, checkpoint WebDev, alteração de domínio ou recurso foi realizado.

Entrou no patch somente **F4**: extração do resultado de SELECT e testes/executor correspondentes. `drizzle`, dependências/lockfile, frontend, `filesRouter` e `rasterRouter` não foram alterados. F1/F2/F5 foram somente comparados com o baseline; relatório próprio registra o resultado.

## 2. Contrato real reproduzido

Instância usada: **MySQL 8.0.46**, **Drizzle ORM 0.44.6**, **mysql2 3.15.1**, versões instaladas do lockfile. O teste chamou `getDb()` real do aplicativo e `database.execute(sql.raw(...))`, sem `vi.mock` de banco/driver. Também chamou o `backupRouter.create` e `backupRouter.verifyRestore` reais por tRPC caller com contexto sintético admin. Isso não é login/OAuth real e não cria bypass no aplicativo.

O SELECT real de `files` devolveu:

```text
[ rows, fields ]
rows: 3 registros SQL
fields: 18 FieldPacket de metadados de colunas
envelope: 2 elementos
```

A extração antiga `Array.isArray(result) ? result : result[0] || []` tratou os dois elementos do envelope como registros. Assim, incorporou listas e metadados do driver ao artefato. A chamada real `backup.create` falhou na verificação da restauração, com hashes divergentes das tabelas e do payload global. A reprodução está em `evidencias/pre-fix/vitest.log`.

**Ressalva do primeiro teste novo:** a primeira tentativa tinha uma expectativa incorreta de `Date` no caminho raw Drizzle. A implementação instalada `mysql2/session.js:23–31` usa `field.string()` para TIMESTAMP/DATETIME/DATE. O log inicial foi preservado: uma falha de expectativa de teste, uma falha F4 real de backup e uma falha decorrente por ausência do backup bem-sucedido. Não são três falhas independentes do produto.

O teste foi calibrado para a string SQL efetivamente observada, e somente a observação do contrato foi repetida antes da correção. `evidencias/contract-calibrated-v2/` comprova 1 caso aprovado, com 2 casos não selecionados. Uma tentativa de invocação de filtro com erro de quoting foi preservada localmente como diagnóstico, não usada como evidência de teste do produto.

## 3. Correção aplicada

O novo `server/backupTableSnapshot.ts`:

1. Exige exatamente um envelope `[rows, fields]`, com ambos os elementos arrays.
2. Extrai somente `result[0]`.
3. Rejeita cabeçalhos DML, envelopes inesperados e entradas não-records/nested arrays; não transforma erro em tabela vazia silenciosa.
4. Preserva os valores das rows sem conversão: rótulos ENUM, números, NULL, JSON, DECIMAL textual e timestamps SQL textuais.
5. Mantém a whitelist física de `backupTableRegistry` e a ordenação existente por chave primária.

`backupRouter.ts` apenas importa esse helper no lugar da implementação incorreta. Foram preservados autorização admin, input/output tRPC, formato do backup, retenção, inventário, storage, hashes e restauração existentes. A mudança não exige migration nem altera schema, usuários/permissões, OAuth ou segredos.

A extração é específica do contrato raw **Drizzle/mysql2** comprovado. Outro driver ou outro envelope deve ser adaptado explicitamente; não existe fallback heurístico para todos os formatos.

## 4. Ensaios e resultados

| Etapa | Resultado | O que prova |
|---|---|---|
| Pré-correção | Falha F4 real reproduzida; logs preservados | Router real exportava envelope/metadados, e restauração falhava por hash |
| Contrato calibrado antes da correção | 1 aprovado, 2 não selecionados | Tuple real, 3 rows, 18 fields, enum/JSON/SQL timestamp |
| Pós-correção — driver/router/arquivo/SQL | **3 testes aprovados em 1 arquivo** | Exportação correta e round-trip descrito abaixo |
| Regressão focada de backup + guardas | **29 testes aprovados em 7 arquivos** | 21 casos existentes de backup e 8 guardas novos; não confundir arrays unitários com driver real |
| TypeScript | Aprovado | `pnpm check` na worktree F4 |
| Build | Aprovado | `pnpm build` offline; aviso preexistente de chunks >500 kB |
| SQL/migrations | GIS histórico aplicado apenas nos dois schemas locais vazios | Bootstrap para os testes; nenhum SQL GIS mudou |
| TiDB/Serverless | Não repetido nesta rodada | O ensaio anterior permanece histórico; F4 não foi reensaiado em TiDB/Serverless |

A suíte histórica de 112 não foi repetida nem rebatizada como homologação. Os testes acima são dirigidos ao módulo alterado e à regressão relevante; não significam execução integral de todos os fluxos do Portal.

### 4.1 Contagens tabulares reais

O snapshot percorreu as **21 tabelas registradas**, com **10 registros sintéticos**:

| Tabela | Registros |
|---|---:|
| users | 3 |
| projects | 2 |
| files | 3 |
| file_versions | 1 |
| saved_maps | 1 |
| Demais 16 tabelas registradas | 0 |

As tabelas vazias foram exportadas como `[]`, não como um envelope de dois elementos. Em cada tabela, as chaves de cada row coincidiram com os nomes de colunas físicos retornados pelo driver. Nenhum array de FieldPacket integrou as rows. Um JSON legítimo da aplicação contendo `nested.fields` foi preservado, demonstrando que a correção não remove campos de negócio apenas por se chamarem `fields`.

### 4.2 Tipos e hashes

Foram verificados número inteiro, ENUM textual (`kml/geojson/geotiff`), JSON objeto/aninhado, NULL, DECIMAL textual (`12.345678`) e timestamp SQL textual (`2026-01-02 03:04:05`). O teste não inventa conversão de timestamp para ISO/Date no backup raw. No helper de restore SQL de teste, os timestamps são regravados em UTC e novamente lidos pelo Drizzle como a mesma string SQL.

**Hash do payload tabular antes/depois da restauração:**

```text
0142582592ab09b6212ce78fb5a33214c252ae69fbcda6ec4f90145baee86aca
```

**SHA-256 do `artifact.json` do ensaio pós-correção:**

```text
78d8ed0afb089b00347f8137d50d5069755a0334790fa86eeb4195686dd82b53
```

Os 21 hashes e contagens por tabela constam de `evidencias/post-fix/driver-contract-report.json`. Os hashes coincidiram entre a consulta independente mysql2 real, o artefato gerado pelo router, a restauração em memória e a releitura do schema SQL de destino.

### 4.3 Restauração efetivamente executada

1. O router real criou o arquivo de backup em filesystem temporário e verificou sua restauração pelo código existente.
2. O teste reabriu o archive e comparou todas as tabelas ao artefato.
3. Três objetos de bytes genéricos sintéticos foram restaurados com hashes iguais aos originais. Eles **não são COGs/GeoTIFF válidos** e não são usados como prova cartográfica.
4. Um helper **exclusivamente no arquivo de teste** inseriu as tabelas restauradas em **outro schema MySQL sintético**, `geoportal_f4_restore`, separado de `geoportal_f4_driver`.
5. As tabelas foram relidas por Drizzle real, e todos os hashes/contagens/tipos conferidos novamente. O `verifyRestore` real do router também passou.

O produto continua tendo restauração em memória pelo adaptador existente. O helper SQL de teste **não acrescenta uma função de restore produtivo** nem autoriza restauração/destruição de banco. As limpezas/DELETEs do helper atingem somente o schema sintético descartável de destino, criado nesta rodada.

## 5. Isolamento e cleanup

O serviço e os comandos de ensaio foram executados em namespaces de rede privados com somente loopback e sem rota externa. Os processos receberam `env -i` e somente variáveis sintéticas. Nenhuma `.env` real foi copiada para a worktree ou lida pelo processo de aplicação de teste; nenhuma configuração gerenciada foi consultada/alterada.

MySQL foi iniciado com `--skip-networking --mysqlx=OFF`, exclusivamente por **socket Unix**, sem listener TCP. `network-addresses.txt`, `network-routes.txt` e `tcp-listeners.txt` preservam os indicadores. O endpoint textual 127.0.0.1 da URI não abriu TCP: `socketPath` conduziu a conexão real.

O serviço encerrou com código 0. `cleanup.json` comprova datadir/socket removidos e nenhuma instância mysqld correspondente remanescente. Volumes filesystem de source/archive e schema de destino eram temporários e foram removidos. Evidências sanitizadas permanecem; datadir, dumps, bytes de clientes, `.env`, dependências instaladas e Git bundle privado não entram no pacote.

## 6. F1/F2/F5 — avaliação de regressão sem ampliação

- **F1:** novo tipo/fluxo com cobertura incompleta; não demonstrada regressão de classificação dos oito rótulos antigos.
- **F2 genérico:** TIFF → image sem raster é preexistente. A UI atual usa raster. Essa troca cria **regressões condicionais por contrato**: bloqueio quando raster não está configurado e rejeição de nome-base TIFF de um caractere (`a.tif` → `name: a`, mínimo 2). Não foi comprovada ocorrência real. MIME alternativo já rejeitado no componente padrão é cobertura incompleta, não retirada de aceitação anterior.
- **F5:** versão inicial ausente no novo caminho raster; integração incompleta, sem garantia baseline raster equivalente removida.

O relatório `REVISAO_REGRESSAO_F1_F2_F5.md` contém fontes/diffs e proposta delimitada. **Nenhum desses itens foi corrigido ou testado funcionalmente nesta rodada.**

## 7. Artefato incremental e limites de aprovação

Patch de código `F4_INCREMENTAL_CODE.patch`, SHA-256:

```text
f47346976e765e69771bb381732611f2cbdc23a198bb68cf7d1275b7f72d1bc2
```

Diff de código `F4_INCREMENTAL_CODE.diff`, SHA-256:

```text
cf31bcb8668d7563710c9a5fec4cf4a5bc88620da94e71615f3694998f850678
```

O diff final foi exportado com `--no-color --no-ext-diff --binary`. A primeira exportação continha códigos ANSI e falhou na leitura de patch; ela e o primeiro ZIP F4 foram preservados. A versão final sem cores e o `.patch` passaram em `git apply --check` contra a worktree f7bf75e, **sem aplicação**. Nenhuma configuração Git foi alterada. Isso é validação de empacotamento, não nova execução de testes ou mudança de código.

São incrementais desde `f7bf75e` e não incorporam F1/F2/F5, mudanças de dependências/schema/auth/storage ou publicação. O pacote complementar inclui os arquivos alterados, relatórios, manifesto atual e logs sanitizados; não substitui o pacote anterior.

F4 está resolvido no escopo ensaiado MySQL/Drizzle/mysql2 local. Isso não certifica backup produtivo, concorrência entre SELECTs, snapshot transacional entre tabelas, grandes volumes/streaming, BLOB/BIGINT fora das fixtures, capacidades Serverless, recuperação dos 11 objetos ou homologação OAuth/browser integral. O exportador continua sequencial e não ganha consistência transacional nova por esta correção. Publicação, DDL e ações externas continuam bloqueados.
