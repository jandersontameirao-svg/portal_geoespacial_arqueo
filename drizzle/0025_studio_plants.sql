CREATE TABLE `studio_plants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`versions` json NOT NULL,
	`createdById` int,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studio_plants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `studio_plants_project_idx` ON `studio_plants` (`projectId`);