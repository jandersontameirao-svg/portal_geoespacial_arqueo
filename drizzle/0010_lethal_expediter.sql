ALTER TABLE `file_versions` ADD `sha256` varchar(64);--> statement-breakpoint
ALTER TABLE `file_versions` ADD `mimeType` varchar(100);--> statement-breakpoint
ALTER TABLE `file_versions` ADD `metadata` json;