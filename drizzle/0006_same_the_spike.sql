CREATE TABLE `gis_uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`filename` varchar(255) NOT NULL,
	`originalName` varchar(255) NOT NULL,
	`fileType` enum('shp','kml','kmz','geojson','gpx','gml','dxf') NOT NULL,
	`fileSize` int NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`s3Key` varchar(500) NOT NULL,
	`s3Url` varchar(1000) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`validationResult` json,
	`metadata` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gis_uploads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `gis_uploads` (`userId`);--> statement-breakpoint
CREATE INDEX `project_id_idx` ON `gis_uploads` (`projectId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `gis_uploads` (`status`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `gis_uploads` (`createdAt`);