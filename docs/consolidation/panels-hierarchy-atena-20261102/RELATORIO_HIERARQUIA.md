# Integração hierarquia PR8 — contratos e ressalvas

Implementação local na cópia autorizada `/home/ubuntu/atena_geoportal_paineis_atena_isolado`, candidata derivada do baseline informado `13bd34ef`. Fonte consultada: PR8 completa `/home/ubuntu/atena_prod_candidate_25f89366`; parecer de dependências lido em `/home/ubuntu/atena_revisao_workspace_zip_20261102/PARECER_AVANCOS_ZIP.md`. Nenhum acesso a produção/stage, configuração, segredo, serviço remoto, download, instalação, deploy ou commit foi realizado por esta subtarefa. As consultas a arquivos do stage foram somente leitura de código local autorizado.

## 1. Escopo efetivamente implementado

- Novos `server/layerTree.ts`, `server/layersRouter.ts`, `server/projectSelectionRouter.ts` e `client/src/components/LayersTree.tsx`.
- Adaptação incremental de `server/geometriesRouter.ts` e `server/baseLayersRouter.ts`.
- Adições somente em `drizzle/schema.ts`: campos de hierarquia, associação de geometria, três tabelas pessoais e `atenaRuns`.
- Novo SQL de revisão `infra/sql/0014_hierarchy_atena_candidate.sql`, sem execução, journal ou snapshots nesta subtarefa.
- Novos testes `server/layerHierarchy.test.ts` (puro/offline) e `server/layerHierarchy.synthetic.test.ts` (opt-in com MySQL/Drizzle reais, sem mock do driver).

Não foram alterados por esta subtarefa `server/routers.ts`, `App`, `Home`, `GlobeViewer`, `ProjectGeoWorkspace`, `db.ts`, `projectAccess.ts` ou arquivos de ambiente/configuração. Esses arquivos podem apresentar mudanças de outros agentes na pasta compartilhada; não são autoria desta subtarefa. O registro dos namespaces e o consumo de `effectiveVisible` nos mapas pertencem ao parent.

## 2. Preservação de dados e políticas

`layers.list` seleciona **todas** as camadas existentes do projeto, inclusive aquelas cujo único conteúdo é `layers.layerData`, sem exigir geometrias associadas. O retorno preserva `layerData`, `metadata`, `metadata.presentation.renderOrder`, `fileId`, `defaultStyle`, CRS, bounds e todos os demais campos existentes. `move` escreve apenas `parentId`/`sortOrder` (além do mecanismo existente de `updatedAt` do Drizzle); não converte nem regrava GeoJSON ou metadados. Não há nova coluna física `renderOrder`: ela permanece onde já era armazenada, em `metadata.presentation.renderOrder`.

A nova ordem da árvore é `sortOrder ASC, id ASC`; não substitui a ordem cartográfica legada. Camadas existentes recebem `parentId=NULL`, `isGroup=false`, `sortOrder=0`. Geometrias existentes recebem `layerId=NULL` e continuam renderizáveis conforme sua flag `visible` original. Não houve migração/reclassificação de payloads.

As leituras de projeto chamam a assinatura atual `requireProjectAccess(projectId, actor)`; as escritas compartilhadas chamam `requireProjectEditor(projectId, actor)`. `projectAccess.ts` não foi substituído. O papel global `client` não ganha edição porque é membro/viewer. Não foi criada política alternativa de autorização baseada só em ids fornecidos pelo cliente. A política atual de editor global + vínculo do projeto permanece exatamente a do helper existente; a subtarefa não reinterpreta os papéis do projeto.

Exceções intencionais: qualquer leitor do projeto pode gravar **somente o próprio** override em `user_layer_visibility`. Qualquer autenticado pode gravar **somente o próprio** override de uma base ativa já existente. `userId` nunca é aceito do input desses procedimentos. Nenhuma dessas operações altera o padrão compartilhado.

## 3. Contratos tRPC para integração

| Namespace/procedimento | Entrada | Saída/garantias |
|---|---|---|
| `layers.list` | `{ projectId: positiveInt }` | Lista plana completa ordenada. Cada linha original + `userVisible:boolean` + `effectiveVisible:boolean`. Exige leitura do projeto. |
| `layers.createGroup` | `{ projectId, name, parentId?:number\|null, sortOrder?:int }` | `{ id, success:true }`. `name` trim 1–255; default ordem 0. Exige editor; pai precisa ser grupo do mesmo projeto. |
| `layers.createLayer` | Anterior + `layerType?:vector\|raster\|tile\|wms\|wmts`, `layerData?:unknown` | `{ id, success:true }`; default vetor, payload opcional. Não expõe edição do vínculo de arquivo nem conversão grupo/folha. |
| `layers.move` | `{ id, parentId:number\|null, sortOrder:int32 }` | Exige editor do projeto da camada, pai grupo no mesmo projeto e ausência de ciclo. Escrita serializada por projeto no MySQL. |
| `layers.setVisibility` | `{ id, visible:boolean }` | Upsert pessoal do usuário autenticado após leitura autorizada do projeto. Não altera `layers.isVisible`. |
| `projectSelection.get` | Sem input | `number[]` pessoal revalidado contra existência de projeto e vínculo atual (admin vê projetos existentes). Seleções obsoletas não vazam dados nem dão acesso. |
| `projectSelection.set` | `{ projectIds:positiveInt[] }`, máximo 500 | Deduplica, filtra sem acesso/inexistentes, salva apenas ids permitidos e retorna `{ success:true,count }`. Serializado por usuário. |
| `geometries.list` | Entrada atual `{ projectId }` | Retorno atual completo + **`effectiveVisible:boolean`**, sem alterar `visible` armazenado. |
| `geometries.listForProjects` | `{ projectIds?:positiveInt[] }` opcional, máximo 500 ids explícitos | Sem input/sem `projectIds`: seleção pessoal segura. `[]` explícito: lista vazia. Projetos inexistentes/sem acesso são omitidos; retorno de geometrias não revela esses projetos. Cada linha inclui `effectiveVisible`. |
| `geometries.moveToLayer` | `{ id:positiveInt, layerId:positiveInt\|null }` | Exige editor do projeto da geometria. Destino precisa ser folha do mesmo projeto; `null` desassocia. Atualiza só vínculo, com audit. |
| `geometries.setLayer` | Igual ao anterior | Alias da mesma implementação para compatibilidade PR8, não versão com permissões diferentes. |
| `geometries.create` | Contrato atual + `layerId?:positiveInt\|null` | Mantém validações atuais de nome, cor, coordenadas e topologia; valida folha/projeto antes de inserir. |
| `geometries.importBatch` | Contrato atual (1–500) + `layerId?` do lote e opcional por geometria | Campo por geometria prevalece, inclusive `null` explícito; se omitido herda o do lote. Valida todas as geometrias/destinos antes de um único INSERT, evitando lote parcialmente importado. |
| `baseLayers.catalog` | Sem input | Apenas linhas ativas de `base_layers` existentes, campos/cache state atuais + `userVisible:boolean`; default pessoal **false**. Não faz download. |
| `baseLayers.setVisibility` | `{ id:positiveInt, visible:boolean }` | Upsert pessoal após validar base existente e ativa. Não cria base/provedor nem altera cache/dados compartilhados. |

`geometries.update`, `delete`, `updateVisibility`, `updateOpacity` e `export` mantêm autorização/validações/topologia existentes. A associação de camada fica no procedimento dedicado; `update` não ganhou um caminho alternativo para editar `layerId` sem validação.

**Consumo do mapa:** usar `effectiveVisible` quando presente, não substituir o dado persistido `visible` ou `isVisible`. O parent deve continuar renderizando GeoJSON de `layerData` e geometrias soltas. Uma geometria é efetivamente visível quando `visible===1` e, se associada, sua camada e todos os ancestrais estão visíveis para o usuário.

Helpers exportados `loadLayerNodesForUser`, `loadLayerNodes` e `requireLeafLayer` são internos/confiáveis, não procedimentos públicos. Seus chamadores devem autorizar o projeto antes de usá-los. Os endpoints deste escopo fazem isso.

### Componente

`LayersTree({ projectId?:number, canEdit?:boolean, onChanged?:()=>void })` preserva a assinatura básica PR8 e acrescenta as props solicitadas. `canEdit` ausente resulta em **false**; o parent deve passar uma permissão de escrita já calculada no servidor. Leitores mantêm os checkboxes pessoais, mas não arrastam/criam/movem nós. Há criação de grupos e folhas na raiz ou dentro de grupos, arraste de nós, recebimento de geometria em folhas e seletor de grupo (alternativa ao arraste). Erros de payload de drag/drop não derrubam o componente. A árvore mostra estados de loading/falha/vazio e não usa dados do projeto anterior como placeholder.

Após mutação bem-sucedida invalida `utils.layers.list`, `utils.geometries.list`, `utils.geometries.listForProjects`, `utils.gisAnalysis.list` e `utils.raster.listForMap`; depois chama `onChanged?.()`.

## 4. Schema aditivo e defaults

| Tabela | Colunas adicionadas | Null/default |
|---|---|---|
| `layers` (existente) | `parentId int`; `isGroup boolean`; `sortOrder int` | `parentId NULL`; `isGroup NOT NULL DEFAULT false`; `sortOrder NOT NULL DEFAULT 0` |
| `geometries` (existente) | `layerId int` | `NULL` = solta/fora da árvore |
| `user_project_selection` | `id int AUTO_INCREMENT PK`, `userId int`, `projectId int`, `createdAt timestamp` | ids do vínculo NOT NULL; `createdAt NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `user_layer_visibility` | `id int AUTO_INCREMENT PK`, `userId int`, `layerId int`, `visible boolean` | demais NOT NULL; `visible` sem default (decisão explícita do usuário) |
| `user_base_layer_visibility` | `id int AUTO_INCREMENT PK`, `userId int`, `baseLayerId int`, `visible boolean` | demais NOT NULL; `visible` sem default; ausência de linha significa false |

Campos de `atena_runs` **exatos da PR8**, sem remoção/renomeação/novo status:

| Coluna | Tipo | Obrigatoriedade/default |
|---|---|---|
| `id` | int AUTO_INCREMENT PK | NOT NULL |
| `projectId` | int | NOT NULL |
| `userId` | int | NOT NULL |
| `status` | enum `queued,running,completed,failed,cancel_requested,cancelled` | NOT NULL DEFAULT `queued` |
| `requestText` | text | NULL |
| `plan` | json | NOT NULL, sem default |
| `idempotencyKey` | varchar(64) | NOT NULL, sem default |
| `codeVersion` | varchar(40) | NOT NULL, sem default |
| `skillVersions` | json | NULL |
| `inputs` | json | NULL |
| `outputs` | json | NULL |
| `steps` | json | NULL |
| `alerts` | json | NULL |
| `errorMessage` | text | NULL |
| `artifactKey` | varchar(500) | NULL |
| `artifactCreatedAt` | timestamp | NULL |
| `createdAt` | timestamp | NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `startedAt` | timestamp | NULL |
| `finishedAt` | timestamp | NULL |

Índices novos (mesmos no schema/SQL): `layers_project_parent_sort_idx(projectId,parentId,sortOrder,id)`; `geometries_project_layer_idx(projectId,layerId)`; `geometries_layer_idx(layerId)`; unicidades PR8 `user_project_sel_unique(userId,projectId)`, `user_layer_vis_unique(userId,layerId)`, `user_base_layer_vis_unique(userId,baseLayerId)` e índices reversos `user_project_sel_project_idx(projectId)`, `user_layer_vis_layer_idx(layerId)`, `user_base_layer_vis_base_idx(baseLayerId)`. Atena preserva `atena_runs_project_key_idx(projectId,idempotencyKey)` e acrescenta índices não únicos `atena_runs_project_created_idx(projectId,createdAt,id)`, `atena_runs_status_created_idx(status,createdAt)` e `atena_runs_user_idx(userId)`.

Não foi acrescentado UNIQUE em `atena_runs.idempotencyKey`: a PR8 usa índice não único composto; deduplicação de execução depende da implementação do backend Atena. Não foram introduzidas FKs retroativas: vinculação, mesmo projeto e grupo/folha são garantidos pelos caminhos de escrita da aplicação. Não há endpoint para converter folha em grupo, excluir grupo/camada ou mudar projeto de uma camada. Intervenções SQL fora da aplicação continuam requerendo saneamento próprio.

Nenhum enum de `files` foi apagado/reordenado/expandido e nenhuma tabela antiga foi substituída. O SQL é novo/aditivo, não replay das migrations PR8 0007–0013.

## 5. Concorrência e limites operacionais

`withLayerHierarchyLock` utiliza `GET_LOCK` do MySQL em conexão **reservada** do pool já existente. O nome incorpora hash do schema + projectId; assim duas instâncias da aplicação disputam o mesmo lock por árvore, sem serializar projetos diferentes. O lock abrange leitura atualizada, verificação pai/ciclo e escrita. `RELEASE_LOCK` e liberação da conexão ficam no `finally`; falha ao liberar o lock destrói a conexão em vez de devolvê-la possivelmente bloqueada ao pool. Timeout de 5s retorna `CONFLICT` para retentativa. Não usa mutex somente em memória nem obtém lock por `pool.execute` desconectado da escrita.

O fluxo normal **não abre transações**, não executa DDL, não abre conexão de serviço externo e não altera `db.ts`. `createGroup`, `createLayer` e `move` deste router passam pelo lock. O próprio MySQL já serializa a obtenção do lock; a suíte sintética contém dois movimentos recíprocos concorrentes para demonstrar que um deve vencer e o outro deve ser rejeitado após reler a árvore.

**Limite:** `GET_LOCK` é lock cooperativo no servidor MySQL. Todos os novos caminhos que moverem nós/reinterpretarem grupo/folha precisam reutilizar o helper. SQL manual, outro backend que ignore o helper ou implantação com escrita concorrente em servidores primários independentes não são protegidos por ele. Não foi homologado um ambiente distribuído desse tipo. Criações Atena em outros arquivos não foram modificadas por este agente; não há conversão/movimento desses nós neste escopo.

Seleção pessoal usa lock análogo por usuário. Para não introduzir transações no fluxo normal, faz upsert dos ids permitidos antes de excluir os não selecionados. Leitura concorrente pode observar um estado intermediário autorizado, mas sempre revalida os vínculos; falha não concede acesso. Não é promessa de substituição transacional da seleção.

A avaliação pura de visibilidade é iterativa e nega ciclo, ancestral ausente e ids duplicados (árvore corrompida). Não modifica flags originais. O cliente também evita recursão infinita; dados com ciclo fechado já corrompido no banco precisam de reparo administrativo e não são corrigidos silenciosamente.

O catálogo novo de bases não aciona nenhum dos downloads legados. Os procedimentos existentes de bases/download/delete foram preservados sem refatoração de permissões fora do escopo autorizado; a adição de catálogo não deve ser confundida com auditoria completa dos procedimentos legados.

## 6. Validação e evidências locais

Executado sem `DATABASE_URL` e com cache Vitest desabilitado:

```sh
env -u DATABASE_URL ./node_modules/.bin/vitest run \
  server/layerHierarchy.test.ts server/layerHierarchy.synthetic.test.ts --cache=false
```

Resultado: **11 testes puros aprovados; 12 testes MySQL sintéticos ignorados intencionalmente** (opt-in ausente). Nenhum mock de driver é apresentado como prova de banco. Log: `hierarchy-offline-tests.log` nesta pasta.

Executado `env -u DATABASE_URL ./node_modules/.bin/tsc --noEmit --incremental false`: **exit 0** na checagem final com os namespaces já integrados pelo parent. O incremental foi desativado para não gravar em `node_modules` compartilhado. Log: `tsc-hierarchy.log`. `git diff --check` dos arquivos existentes deste escopo passou. Uma checagem avulsa de tipos dos testes, sem os aliases do tsconfig do projeto, apontou aliases/declaracões ausentes; não é falha da checagem oficial. A inspeção tipada de tamanhos varchar dos testes foi ajustada para `getSQLType()`.

### Suíte real preparada para o executor do parent (não executada por este agente)

- `HIERARCHY_ATENA_SYNTHETIC=1` e `NODE_ENV=test` obrigatórios.
- URL exata local: `mysql://root@127.0.0.1/geoportal_panels_atena?socketPath=/tmp/atena-panels-atena.XXXX/mysql-data/mysql.sock&timezone=Z`. Sem senha, porta, hostname alternativo ou opções adicionais.
- `HIERARCHY_ATENA_LOCAL_ROOT` deve corresponder ao diretório descartável real `/tmp/atena-panels-atena.<sufixo>` sem symlink.
- Conexão usa o socket explicitamente, confirma o nome do schema e `@@skip_networking=1` antes das fixtures/imports de persistência; não cria schema/tabela nem aplica migration.
- `HIERARCHY_ATENA_EVIDENCE_DIR` aceita subdiretório do relatório autorizado ou do root descartável; grava `hierarchy-real-driver-report.json` com cenários efetivamente aprovados.
- Fixtures reservadas: usuários 81001–81004, projetos 81101–81102, camada legada 81201, bases 81301–81302, geometria solta 81401 e arquivo 81999. A suíte usa INSERTs explícitos em schema descartável e não deve ser repetida sobre as mesmas fixtures sem reset. Requer as tabelas baseline e nova migration antes de executar.
- Cobertura preparada: vínculo/anon/client/admin; camada GeoJSON e metadados legados; grupos aninhados; pai folha/crossproject/ciclo; dois movimentos recíprocos simultâneos; override pessoal com cascata/upsert; geometria solta e associação de folha; topologia/update/delete/import atomic; seleção explícita/persistida/revogada; catálogo/base inativa sem download; colunas/defaults reais de `atena_runs` e índice hierárquico.

**Próximo passo obrigatório do parent:** gerar/revisar a migration oficial 0014 e journal/snapshot (este agente não os tocou), executar a suíte no namespace MySQL isolado sem rede e confirmar consumo visual de `layerData`/`effectiveVisible`. O SQL candidato de `infra/sql` é revisão local: **não aplicar junto da migration oficial gerada; não é autorização para DDL remoto**. Nem os testes puros nem a compilação comprovam banco, produção ou homologação cartográfica.
