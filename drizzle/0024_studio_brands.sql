CREATE TABLE `studio_brands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`kind` enum('empresa','cliente') NOT NULL,
	`image` text NOT NULL,
	`createdById` int,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studio_brands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `studio_brands_kind_idx` ON `studio_brands` (`kind`);