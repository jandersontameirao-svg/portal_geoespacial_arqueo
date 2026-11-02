# SQL aditivo 0014 — hierarquia, preferências pessoais e Atena

**REVISÃO LOCAL. Não executado em produção/stage.** Baseline de código: `13bd34ef34e91bba0b813249dda2469d78fd8761`. O lote GIS 0007–0013 anterior não é reutilizado nem alterado. Autorização daquele lote não se estende automaticamente a este SQL novo.

Arquivo canônico: `drizzle/0014_hierarchy_atena.sql`. SHA-256: `aefe1d867073dd95e6ef66b91e0f771ef7037594aedbcbc028812e4291136de5`. Gerado pelo Drizzle local a partir do schema integrado; journal recebe a entrada 0014 e snapshot 0014. O arquivo manual `infra/sql/0014_hierarchy_atena_candidate.sql` é rascunho histórico de revisão; **não aplicar ambos**. A ordem e os nomes de constraints canônicos são os do bloco literal abaixo.

## Atual → alvo

| Objeto | Estado de referência antes deste lote | Alvo aditivo / efeito |
|---|---|---|
| layers | GeoJSON/metadata/fileId/CRS existentes, sem hierarquia arbitrária | parentId NULL; isGroup NOT NULL DEFAULT false; sortOrder NOT NULL DEFAULT 0. Nenhum payload ou ordem cartográfica em metadata é reescrito. |
| geometries | Geometrias legadas sem vínculo opcional à árvore | layerId int NULL. NULL continua geometria solta, renderizável. Nenhuma migração de coordenadas. |
| user_project_selection | Tabela nova | Seleções pessoais; unique userId/projectId, data criada automaticamente. Sem seed/backfill de seleção. |
| user_layer_visibility | Tabela nova | Override pessoal boolean explícito. Ausência mantém padrão compartilhado. Unique userId/layerId. |
| user_base_layer_visibility | Tabela nova | Override pessoal boolean explícito; ausência significa base global oculta. Unique userId/baseLayerId. |
| atena_runs | Tabela nova | Histórico, plano, impressão digital, estados, passos, outputs e chave de PDF. Sem execução ou criação de run por migration. |

São quatro tabelas novas, quatro colunas adicionadas a tabelas existentes, dez índices não únicos e três constraints de unicidade, além das quatro chaves primárias novas. Não há DROP, DELETE, UPDATE de clientes, seed, FK retroativa, ALTER ENUM de files nem troca de auth/configuração. Vínculos de mesmo projeto/folha/permissão são revalidados pelo aplicativo; ausência de FK não protege SQL manual fora do aplicativo.

## Defaults, índices e histórico

Todos os registros layers existentes recebem os defaults boolean/ordem e parentId NULL; geometries recebe layerId NULL. ENUM atena_runs mantém queued/running/completed/failed/cancel_requested/cancelled, default queued. Campos de timestamps opcionais permanecem NULL; createdAt usa now. JSON plan é obrigatório sem default: uma execução só nasce por escrita explícita do motor. idempotencyKey é indexado com projectId, mas não UNIQUE; deduplicação usa transação de projeto e leitura atual do histórico. O código bloqueia resultados parciais com commit/rollback SQL, não promete atomicidade com storage remoto.

Migrations 0000–0013 foram comparadas byte a byte com o baseline informado e permaneceram idênticas. Não renumerar ou executar novamente migrations PR8 0007–0012. O journal real do novo ensaio MySQL contém 15 entradas depois da aplicação de 0000–0014.

## Ensaio e compatibilidade

O SQL canônico foi aplicado pelo migrador Drizzle somente no schema descartável geoportal_panels_atena, MySQL 8.0.46, por socket Unix, skip-networking e rede sem rota externa. A execução aprovada é evidence/mysql-run-2: 164 testes/13 arquivos, incluindo 12 contratos de hierarquia e 5 do motor/ponte com banco real. Não são login OAuth ou homologação integral. A primeira tentativa aplicou o SQL local, mas não iniciou testes por conflito min/max workers do Vitest; evidência e cleanup preservados.

Para TiDB 8.5.3, esta migration é analisada como DDL padrão compatível com os tipos e alterações já exercitados no lote anterior, mas **0014 e a nova concorrência não foram ensaiados no TiDB nesta rodada**. O ensaio TiDB anterior prova somente o SQL e o código de sua própria referência. Edição Serverless e runtime gerenciado permanecem sujeitos aos limites do serviço.

## Locks e concorrência

DDL ADD COLUMN e CREATE INDEX pode consumir recursos, manter metadata locks/transientes e falhar em concorrência; online não significa ausência absoluta de lock ou impacto. Não foram medidos duração, tamanho de tabelas ou orçamento de recursos do ambiente real nesta rodada. A janela deve verificar journal, schema, jobs DDL e destino antes de executar, sem alterar sessão/configuração implicitamente. Operações DDL não formam uma transação global atômica: em falha parcial, parar, inventariar exatamente o aplicado e revisar uma correção forward; nunca repetir cegamente o arquivo inteiro.

Na aplicação, movimentações são serializadas por linha-âncora do projeto; seleção pessoal por linha do usuário. MySQL usa START TRANSACTION; TiDB usa BEGIN PESSIMISTIC explicitamente, sem SET GLOBAL/SESSION. A árvore/histórico usa FOR UPDATE após a âncora para leitura atual, não snapshot anterior. Não se depende de GET_LOCK entre instâncias TiDB. Consultas de listagem comuns não adquirem esses locks. A garantia pressupõe que escritores concorrentes adotem o mesmo protocolo; falha de sintaxe, deadlock ou timeout aborta e não opera sem lock. [1]

## Recuperação preservando escritas

Não apagar colunas, tabelas, preferências, runs ou resultados para reverter código. A primeira alternativa é interromper novas execuções Atena e voltar somente o código ao checkpoint anterior 13bd34ef, mantendo o schema expandido e todas as escritas novas; os campos novos são opcionais/default e as tabelas antigas não foram substituídas. Essa compatibilidade é arquitetural nesta rodada, não um ensaio concluído de rollback do novo módulo. O ensaio anterior de resgate F1/F2 sobre schema GIS não prova automaticamente a reversão após 0014.

Manter cópias/hash de código e backup de janela recuperável no ambiente seguro antes do lote real; não substituir dados por dump antigo nem perder escritas posteriores. Caso a volta de código não seja suficiente, usar correção forward revisada; qualquer restauração seletiva requer conciliação por IDs e preservação das novas escritas. O baseline 04e64773 foi reprovado no ensaio de segurança anterior e não deve ser tratado como alvo de recuperação segura.

O inventário de backup do novo código inclui as quatro tabelas novas e artifactKey dos PDFs Atena. Manifestos novos usam 2.1, enquanto verificação 2.0 usa o conjunto histórico exato; testes puros confirmam ambos. Backups produzidos pelo código antigo não capturam automaticamente as novas tabelas. A troca de exportador deve acompanhar a release; não executar backup produtivo nesta rodada de implementação.

## SQL literal completo

```sql
CREATE TABLE `atena_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('queued','running','completed','failed','cancel_requested','cancelled') NOT NULL DEFAULT 'queued',
	`requestText` text,
	`plan` json NOT NULL,
	`idempotencyKey` varchar(64) NOT NULL,
	`codeVersion` varchar(40) NOT NULL,
	`skillVersions` json,
	`inputs` json,
	`outputs` json,
	`steps` json,
	`alerts` json,
	`errorMessage` text,
	`artifactKey` varchar(500),
	`artifactCreatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	CONSTRAINT `atena_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_base_layer_visibility` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`baseLayerId` int NOT NULL,
	`visible` boolean NOT NULL,
	CONSTRAINT `user_base_layer_visibility_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_base_layer_vis_unique` UNIQUE(`userId`,`baseLayerId`)
);
--> statement-breakpoint
CREATE TABLE `user_layer_visibility` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`layerId` int NOT NULL,
	`visible` boolean NOT NULL,
	CONSTRAINT `user_layer_visibility_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_layer_vis_unique` UNIQUE(`userId`,`layerId`)
);
--> statement-breakpoint
CREATE TABLE `user_project_selection` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_project_selection_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_project_sel_unique` UNIQUE(`userId`,`projectId`)
);
--> statement-breakpoint
ALTER TABLE `geometries` ADD `layerId` int;--> statement-breakpoint
ALTER TABLE `layers` ADD `parentId` int;--> statement-breakpoint
ALTER TABLE `layers` ADD `isGroup` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `layers` ADD `sortOrder` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `atena_runs_project_key_idx` ON `atena_runs` (`projectId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `atena_runs_project_created_idx` ON `atena_runs` (`projectId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `atena_runs_status_created_idx` ON `atena_runs` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `atena_runs_user_idx` ON `atena_runs` (`userId`);--> statement-breakpoint
CREATE INDEX `user_base_layer_vis_base_idx` ON `user_base_layer_visibility` (`baseLayerId`);--> statement-breakpoint
CREATE INDEX `user_layer_vis_layer_idx` ON `user_layer_visibility` (`layerId`);--> statement-breakpoint
CREATE INDEX `user_project_sel_project_idx` ON `user_project_selection` (`projectId`);--> statement-breakpoint
CREATE INDEX `geometries_project_layer_idx` ON `geometries` (`projectId`,`layerId`);--> statement-breakpoint
CREATE INDEX `geometries_layer_idx` ON `geometries` (`layerId`);--> statement-breakpoint
CREATE INDEX `layers_project_parent_sort_idx` ON `layers` (`projectId`,`parentId`,`sortOrder`,`id`);
```

## Referência

[1]: https://docs.pingcap.com/tidb/v8.5/pessimistic-transaction/ "TiDB 8.5 — Pessimistic Transaction Mode"
