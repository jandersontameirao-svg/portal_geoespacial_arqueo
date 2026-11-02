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