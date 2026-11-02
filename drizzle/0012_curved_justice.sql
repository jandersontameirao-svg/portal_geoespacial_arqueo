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