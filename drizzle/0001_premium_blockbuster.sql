CREATE TABLE `atlas_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`templateType` enum('abnt_tecnico','cliente') NOT NULL,
	`pageSize` enum('A4','A3','A1','A0') NOT NULL,
	`orientation` enum('portrait','landscape') NOT NULL DEFAULT 'landscape',
	`scale` int NOT NULL,
	`coverageArea` json NOT NULL,
	`gridConfig` json,
	`crs` varchar(50) NOT NULL DEFAULT 'EPSG:31982',
	`utmZone` int,
	`layersConfig` json,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`progress` int NOT NULL DEFAULT 0,
	`currentPage` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`outputUrl` text,
	`outputS3Key` varchar(500),
	`individualPagesUrls` json,
	`requestedBy` int NOT NULL,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `atlas_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userEmail` varchar(320),
	`userName` varchar(255),
	`action` varchar(100) NOT NULL,
	`entityType` varchar(100),
	`entityId` int,
	`projectId` int,
	`details` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `file_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileId` int NOT NULL,
	`version` int NOT NULL,
	`s3Key` varchar(500) NOT NULL,
	`s3Url` text NOT NULL,
	`fileSize` int NOT NULL,
	`uploadedBy` int NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`changeDescription` text,
	CONSTRAINT `file_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `file_version_unique` UNIQUE(`fileId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`originalName` varchar(255) NOT NULL,
	`fileType` enum('kml','kmz','shp','pdf','docx','xlsx','image','other') NOT NULL,
	`mimeType` varchar(100),
	`fileSize` int NOT NULL,
	`s3Key` varchar(500) NOT NULL,
	`s3Url` text NOT NULL,
	`isGeospatial` boolean NOT NULL DEFAULT false,
	`crs` varchar(50),
	`bounds` json,
	`metadata` json,
	`currentVersion` int NOT NULL DEFAULT 1,
	`uploadedBy` int NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deletedAt` timestamp,
	CONSTRAINT `files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','editor','client') NOT NULL,
	`token` varchar(255) NOT NULL,
	`invitedBy` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `layers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`fileId` int,
	`name` varchar(255) NOT NULL,
	`description` text,
	`layerType` enum('vector','raster','tile','wms','wmts') NOT NULL,
	`layerData` json,
	`styleId` int,
	`defaultStyle` json,
	`crs` varchar(50) NOT NULL DEFAULT 'EPSG:4674',
	`bounds` json,
	`isVisible` boolean NOT NULL DEFAULT true,
	`isPublic` boolean NOT NULL DEFAULT false,
	`metadata` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `layers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`savedMapId` int,
	`name` varchar(255) NOT NULL,
	`templateType` enum('abnt_tecnico','cliente') NOT NULL,
	`pageSize` enum('A4','A3','A1','A0') NOT NULL,
	`orientation` enum('portrait','landscape') NOT NULL DEFAULT 'landscape',
	`scale` int NOT NULL,
	`crs` varchar(50) NOT NULL DEFAULT 'EPSG:31982',
	`utmZone` int,
	`title` varchar(255) NOT NULL,
	`subtitle` varchar(255),
	`author` varchar(255),
	`showNorthArrow` boolean NOT NULL DEFAULT true,
	`showScaleBar` boolean NOT NULL DEFAULT true,
	`showLegend` boolean NOT NULL DEFAULT true,
	`showGrid` boolean NOT NULL DEFAULT true,
	`showFrame` boolean NOT NULL DEFAULT true,
	`layersConfig` json,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`progress` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`outputUrl` text,
	`outputS3Key` varchar(500),
	`requestedBy` int NOT NULL,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `print_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','editor','viewer') NOT NULL DEFAULT 'viewer',
	`addedBy` int NOT NULL,
	`addedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_user_unique` UNIQUE(`projectId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`code` varchar(100) NOT NULL,
	`description` text,
	`clientName` varchar(255),
	`clientDocument` varchar(50),
	`aoiGeometry` json,
	`aoiBounds` json,
	`status` enum('active','archived','completed') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `saved_maps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`viewMode` enum('2d','3d') NOT NULL DEFAULT '3d',
	`center` json NOT NULL,
	`zoom` decimal(10,6),
	`heading` decimal(10,6),
	`pitch` decimal(10,6),
	`activeLayers` json,
	`basemap` varchar(100),
	`thumbnailUrl` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `saved_maps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `styles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`styleType` enum('sld','mapbox','cesium','custom') NOT NULL,
	`styleDefinition` json NOT NULL,
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `styles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','editor','client') NOT NULL DEFAULT 'client';--> statement-breakpoint
ALTER TABLE `users` ADD `mfaEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfaSecret` varchar(255);--> statement-breakpoint
CREATE INDEX `project_idx` ON `atlas_jobs` (`projectId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `atlas_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `requested_by_idx` ON `atlas_jobs` (`requestedBy`);--> statement-breakpoint
CREATE INDEX `user_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `entity_idx` ON `audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `audit_logs` (`projectId`);--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `file_idx` ON `file_versions` (`fileId`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `files` (`projectId`);--> statement-breakpoint
CREATE INDEX `file_type_idx` ON `files` (`fileType`);--> statement-breakpoint
CREATE INDEX `uploaded_by_idx` ON `files` (`uploadedBy`);--> statement-breakpoint
CREATE INDEX `token_idx` ON `invitations` (`token`);--> statement-breakpoint
CREATE INDEX `email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `layers` (`projectId`);--> statement-breakpoint
CREATE INDEX `file_idx` ON `layers` (`fileId`);--> statement-breakpoint
CREATE INDEX `layer_type_idx` ON `layers` (`layerType`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `print_jobs` (`projectId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `print_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `requested_by_idx` ON `print_jobs` (`requestedBy`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `project_members` (`projectId`);--> statement-breakpoint
CREATE INDEX `user_idx` ON `project_members` (`userId`);--> statement-breakpoint
CREATE INDEX `code_idx` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `created_by_idx` ON `projects` (`createdBy`);--> statement-breakpoint
CREATE INDEX `project_idx` ON `saved_maps` (`projectId`);--> statement-breakpoint
CREATE INDEX `created_by_idx` ON `saved_maps` (`createdBy`);--> statement-breakpoint
CREATE INDEX `name_idx` ON `styles` (`name`);--> statement-breakpoint
CREATE INDEX `email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `role_idx` ON `users` (`role`);