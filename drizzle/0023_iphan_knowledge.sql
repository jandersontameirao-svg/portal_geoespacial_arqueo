CREATE TABLE `iphan_knowledge` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`siteId` int NOT NULL,
	`codigo` varchar(100),
	`nome` varchar(300),
	`classificacao` varchar(150),
	`tipoBem` varchar(150),
	`sintese` text,
	`fonte` varchar(150),
	`camada` varchar(100),
	`savedById` int,
	`savedByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `iphan_knowledge_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `iphan_knowledge_project_idx` ON `iphan_knowledge` (`projectId`);--> statement-breakpoint
CREATE INDEX `iphan_knowledge_site_idx` ON `iphan_knowledge` (`siteId`);