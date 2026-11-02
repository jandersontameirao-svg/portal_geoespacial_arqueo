-- CANDIDATE LOCAL REVIEW ONLY. This file is NOT authorization to execute in production/stage.
-- New additive DDL for baseline 13bd34ef; not a replay of PR8 migrations 0007-0013.
-- Apply exactly once to a disposable synthetic schema, or use the parent's generated
-- official 0014 migration instead. Do NOT apply both. No journal/snapshot changes here.
-- Existing layerData, metadata.presentation.renderOrder, fileId, enums and tables stay intact.
ALTER TABLE `layers`
  ADD COLUMN `parentId` int NULL,
  ADD COLUMN `isGroup` boolean NOT NULL DEFAULT false,
  ADD COLUMN `sortOrder` int NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `layers_project_parent_sort_idx` ON `layers` (`projectId`,`parentId`,`sortOrder`,`id`);
--> statement-breakpoint
ALTER TABLE `geometries` ADD COLUMN `layerId` int NULL;
--> statement-breakpoint
CREATE INDEX `geometries_project_layer_idx` ON `geometries` (`projectId`,`layerId`);
--> statement-breakpoint
CREATE INDEX `geometries_layer_idx` ON `geometries` (`layerId`);
--> statement-breakpoint
CREATE TABLE `user_project_selection` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `projectId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `user_project_sel_unique` UNIQUE (`userId`,`projectId`),
  INDEX `user_project_sel_project_idx` (`projectId`)
);
--> statement-breakpoint
CREATE TABLE `user_layer_visibility` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `layerId` int NOT NULL,
  `visible` boolean NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `user_layer_vis_unique` UNIQUE (`userId`,`layerId`),
  INDEX `user_layer_vis_layer_idx` (`layerId`)
);
--> statement-breakpoint
CREATE TABLE `user_base_layer_visibility` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `baseLayerId` int NOT NULL,
  `visible` boolean NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `user_base_layer_vis_unique` UNIQUE (`userId`,`baseLayerId`),
  INDEX `user_base_layer_vis_base_idx` (`baseLayerId`)
);
--> statement-breakpoint
-- Exact PR8 columns/types/defaults, with additional non-unique queue/history indexes.
CREATE TABLE `atena_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `status` enum('queued','running','completed','failed','cancel_requested','cancelled') NOT NULL DEFAULT 'queued',
  `requestText` text NULL,
  `plan` json NOT NULL,
  `idempotencyKey` varchar(64) NOT NULL,
  `codeVersion` varchar(40) NOT NULL,
  `skillVersions` json NULL,
  `inputs` json NULL,
  `outputs` json NULL,
  `steps` json NULL,
  `alerts` json NULL,
  `errorMessage` text NULL,
  `artifactKey` varchar(500) NULL,
  `artifactCreatedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `startedAt` timestamp NULL,
  `finishedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  INDEX `atena_runs_project_key_idx` (`projectId`,`idempotencyKey`),
  INDEX `atena_runs_project_created_idx` (`projectId`,`createdAt`,`id`),
  INDEX `atena_runs_status_created_idx` (`status`,`createdAt`),
  INDEX `atena_runs_user_idx` (`userId`)
);
