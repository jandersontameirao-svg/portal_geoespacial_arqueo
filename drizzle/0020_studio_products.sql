CREATE TABLE `studio_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`productKey` varchar(80) NOT NULL,
	`title` varchar(120) NOT NULL,
	`config` json NOT NULL,
	`createdById` int,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studio_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `studio_products_project_key_uq` UNIQUE(`projectId`,`productKey`)
);
