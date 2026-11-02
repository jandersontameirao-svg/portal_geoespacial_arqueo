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