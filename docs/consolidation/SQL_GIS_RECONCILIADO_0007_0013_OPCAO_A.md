# SQL GIS reconciliado — migrations 0007–0013 (Opção A)

**Status:** documento de revisão. Nenhum SQL foi aplicado em produção ou homologação nesta rodada.

## Proveniência e pré-condição

- Baseline produtivo comparado: `04e64773d0c2a9b4cb25fa7f4d1015646fb11091` (journal até `0006`).
- Candidata isolada: conteúdo consolidado da linha GIS, sem incorporar migrations PR8 0007–0012 conflitantes.
- Aplicação futura: somente em sequência, via journal Drizzle, após preflight de schema/journal, backup recuperável e aprovação explícita de DDL.
- A migration `0007` foi reconciliada nesta candidata: **não reduz** `endpoint` para 500; preserva `VARCHAR(1000)` e indexa `endpointHash` SHA-256.

## Resultado do ensaio isolado

- MySQL 8 local, schema vazio `geoportal_synthetic`, destruído automaticamente ao final.
- Journal `0000`–`0013` aplicado com sucesso.
- Fixture mínima exclusivamente sintética: usuários admin/editor/client.
- 31 arquivos / 112 testes aprovados; typecheck e build aprovados.
- O banco atual de referência não possui `ogc_services`; portanto não há endpoints existentes a converter ou truncar.

### Correção de integridade documental — preflight somente leitura

- Em 02/11/2026, o hash efetivo de `0007_lonely_freak.sql` foi revalidado contra o log do ensaio sintético: `78556354f5abc173227ea056390b7928cd3049762b2fc331cfebf5f5c1b271ab`.
- Verificação byte a byte posterior confirmou que `CREATE INDEX backup_inventory_created_idx ON backup_inventories (createdAt)` integra `0013_glamorous_betty_brant.sql` nos commits funcionais `5fa06ac` e `fcbc5aa`; o SQL literal abaixo mantém ambos os índices de `0013`.
- Esta correção é documental: nenhum SQL, schema, banco, ambiente ou pacote `fcbc5aa` foi alterado por ela.

### Atualização empírica — TiDB local 8.5.3, 02/11/2026

- O mesmo SQL literal `0000–0013` passou em TiDB Community `8.0.11-TiDB-v8.5.3`, com TiKV/PD locais descartáveis. O migrador Drizzle também passou em outro schema sintético: 14 entradas de journal com hashes exatos.
- A suíte no checkout `57f6a07fd573a256eaed2905c0655effa5971d19` passou: 31 arquivos / 112 testes. Nenhuma migration foi modificada para esse ensaio.
- `0008 → 0009` foram exercitadas com oito valores antigos de `files.fileType` já persistidos; todos os rótulos foram preservados e `geotiff`/`geojson` foram aceitos. Os ordinais numéricos mudam: não tratar enum como número estável.
- O primeiro wrapper excedeu seu prazo durante downloads; a mesma instância foi aproveitada sem reinstalação. O bind de status padrão `0.0.0.0:10080` foi corrigido para loopback antes do SQL. Esse incidente e o cleanup estão documentados, não ocultados.
- Community local **não é a edição `8.5.3-serverless`**: tempos/locks em volume, política cloud, limites gerenciados e rollback do código anterior com schema novo continuam não comprovados. Não há aprovação de DDL de produção/stage.
- Evidências: `evidence/tidb-8.5.3-local-literal-1/`, `evidence/tidb-8.5.3-local-enum-journal-1/` e `ENSAIO_LOCAL_TIDB_8_5_3_SERVERLESS_LIMITES_2026-11-02.md`.

## Locks, compatibilidade e rollback operacional

- `ALTER TABLE` em `files`, `file_versions`, `base_layers` e `atlas_jobs` pode aguardar metadata lock e requer janela sem upload, processamento de camada e geração de Atlas.
- MySQL DDL pode efetuar commit implícito; não há rollback transacional global seguro de uma sequência parcialmente aplicada.
- Em falha pós-DDL, rollback operacional recomendado: voltar apenas o código a release anterior compatível **mantendo schema novo e escritas posteriores**. Não executar DROP, truncamento, alteração de coordenadas ou exclusão automática.
- PR8 Atena continua fase posterior: suas migrations 0007–0012 não devem ser executadas diretamente por colisão de numeração/semântica.
- O destino de referência é TiDB 8.5.3 Serverless. A aceitação local de `0008`/`0009` e do journal agora está comprovada em Community 8.5.3; o ensaio não certifica a edição gerenciada, volume real, locks ou rollback integral. Ver `ANALISE_COMPATIBILIDADE_TIDB_8_5_3_GIS_0007_0013.md`.

## SQL exato e hashes

### `0007_lonely_freak.sql`

- SHA-256: `78556354f5abc173227ea056390b7928cd3049762b2fc331cfebf5f5c1b271ab`
- Efeito: Catálogo OGC e variantes; cria tabelas novas e índices. Endpoint integral de 1.000 caracteres é preservado; unicidade usa endpointHash SHA-256 de 64 caracteres.
- Impacto/lock: CREATE TABLE/CREATE INDEX. Sem alterar tabelas existentes no baseline 04e64773.

```sql
CREATE TABLE `ogc_catalog_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`logicalLayer` varchar(255) NOT NULL,
	`serviceId` int NOT NULL,
	`remoteLayer` varchar(500) NOT NULL,
	`role` enum('primary','fallback') NOT NULL,
	`priority` int NOT NULL DEFAULT 1,
	`displayCrs` varchar(50) NOT NULL DEFAULT 'EPSG:4674',
	`attribution` text,
	`enabled` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ogc_catalog_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `ogc_layer_priority_unique` UNIQUE(`logicalLayer`,`priority`)
);
--> statement-breakpoint
CREATE TABLE `ogc_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`publisher` varchar(255) NOT NULL,
	`serviceType` enum('wms','wfs') NOT NULL,
	`sourceClass` enum('official','approved_custom') NOT NULL DEFAULT 'official',
	`endpoint` varchar(1000) NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`status` enum('draft','validated','published','degraded','unhealthy','disabled') NOT NULL DEFAULT 'draft',
	`enabled` boolean NOT NULL DEFAULT false,
	`health` enum('healthy','timeout','tls_error','http_error','invalid_capabilities','blocked') NOT NULL DEFAULT 'blocked',
	`lastValidatedAt` timestamp,
	`lastHealthyAt` timestamp,
	`lastError` varchar(500),
	`capabilities` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ogc_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `ogc_endpoint_hash_unique` UNIQUE(`endpointHash`)
);
--> statement-breakpoint
CREATE INDEX `ogc_variant_service_idx` ON `ogc_catalog_variants` (`serviceId`);--> statement-breakpoint
CREATE INDEX `ogc_status_idx` ON `ogc_services` (`status`,`enabled`);
```

### `0008_early_pyro.sql`

- SHA-256: `43e72dec9ef9157aab79754e234fd25f1b444a0a5d3745eb87bda52c07b0b4c6`
- Efeito: Amplia o enum files.fileType para GeoTIFF.
- Impacto/lock: ALTER TABLE em files; pode esperar metadata lock.

```sql
ALTER TABLE `files` MODIFY COLUMN `fileType` enum('kml','kmz','shp','geotiff','pdf','docx','xlsx','image','other') NOT NULL;
```

### `0009_quiet_runaways.sql`

- SHA-256: `831b9fa381b131345d78190b971db94d8fa2a0982482b2edd002eaef0e70712a`
- Efeito: Amplia o enum files.fileType para GeoJSON e GeoTIFF.
- Impacto/lock: ALTER TABLE em files; depende da ordem do journal.

```sql
ALTER TABLE `files` MODIFY COLUMN `fileType` enum('kml','kmz','shp','geojson','geotiff','pdf','docx','xlsx','image','other') NOT NULL;
```

### `0010_lethal_expediter.sql`

- SHA-256: `f03665b58bf3a49e6f200375f307453f08c1de3382927c53385b192cc2b64ed1`
- Efeito: Adiciona integridade/versionamento a file_versions.
- Impacto/lock: ALTER TABLE em file_versions e índice; campos novos preservam registros preexistentes por defaults/nullable conforme SQL.

```sql
ALTER TABLE `file_versions` ADD `sha256` varchar(64);--> statement-breakpoint
ALTER TABLE `file_versions` ADD `mimeType` varchar(100);--> statement-breakpoint
ALTER TABLE `file_versions` ADD `metadata` json;
```

### `0011_abandoned_wraith.sql`

- SHA-256: `b904455fb078de6c1663b3c99d7d829fd52ab9275e5898987046e63aaea85b68`
- Efeito: Adiciona estado de tentativa/backoff de fontes oficiais em base_layers.
- Impacto/lock: ALTER TABLE em base_layers; mantém cache/URLs existentes.

```sql
ALTER TABLE `base_layers` ADD `refreshFailureCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `base_layers` ADD `lastRefreshAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `base_layers` ADD `retryAfter` timestamp;
```

### `0012_curved_justice.sql`

- SHA-256: `26d483a173339fea0cc9d52ddadb86a6d503677bcbb39ce7f2af8d71a723dd15`
- Efeito: Cria templates Atlas e adiciona vínculo/configuração aos jobs.
- Impacto/lock: CREATE TABLE e ALTER TABLE em atlas_jobs; pode esperar metadata lock em atlas_jobs.

```sql
CREATE TABLE `atlas_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`templateType` enum('abnt_tecnico','cliente') NOT NULL,
	`config` json NOT NULL,
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `atlas_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `atlas_template_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `atlas_jobs` ADD `templateId` int;--> statement-breakpoint
ALTER TABLE `atlas_jobs` ADD `renderConfig` json;--> statement-breakpoint
CREATE INDEX `project_idx` ON `atlas_templates` (`projectId`);
```

### `0013_glamorous_betty_brant.sql`

- SHA-256: `0cc30c755839926326b98de502e2fe4f6cca9e54e92b421b27ebff7f3b857c3d`
- Efeito: Cria política e inventário de backup.
- Impacto/lock: CREATE TABLE/CREATE INDEX; não copia dados nem objetos por si só.

```sql
CREATE TABLE `backup_inventories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`backupId` varchar(64) NOT NULL,
	`storageMode` enum('filesystem') NOT NULL,
	`status` enum('complete','incomplete','expired','purged') NOT NULL DEFAULT 'complete',
	`manifestKey` varchar(1024) NOT NULL,
	`manifestChecksumKey` varchar(1024) NOT NULL,
	`manifestSha256` varchar(64) NOT NULL,
	`artifactSha256` varchar(64) NOT NULL,
	`archiveBytes` bigint NOT NULL,
	`objectBytes` bigint NOT NULL,
	`totalRecords` int NOT NULL,
	`requiredObjects` int NOT NULL,
	`copiedObjects` int NOT NULL,
	`missingObjects` int NOT NULL,
	`retentionDays` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`restoreVerifiedAt` timestamp,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backup_inventories_id` PRIMARY KEY(`id`),
	CONSTRAINT `backup_inventories_backupId_unique` UNIQUE(`backupId`)
);
--> statement-breakpoint
CREATE TABLE `backup_policies` (
	`id` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`intervalHours` int NOT NULL DEFAULT 24,
	`retentionDays` int NOT NULL DEFAULT 30,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `backup_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `backup_inventory_expiry_idx` ON `backup_inventories` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `backup_inventory_created_idx` ON `backup_inventories` (`createdAt`);
```

## Decisão pendente

Aprovar ou rejeitar o conjunto GIS reconciliado 0007–0013 como lote aditivo; a aprovação não inclui migrations Atena PR8, seeds, dados, usuários, permissões, segredos, objetos legados ou publicação.
