CREATE TABLE `ogc_catalog_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`logicalLayer` varchar(255) NOT NULL,
	`serviceId` int NOT NULL,
	`remoteLayer` varchar(500) NOT NULL,
	`role` enum('primary','fallback') NOT NULL,
	`priority` int NOT NULL DEFAULT 1,
	`displayCrs` varchar(50) NOT NULL DEFAULT 'EPSG:4674',
	`attribution` text,
	`enabled` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ogc_catalog_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `ogc_layer_priority_unique` UNIQUE(`logicalLayer`,`priority`)
);
--> statement-breakpoint
CREATE TABLE `ogc_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`publisher` varchar(255) NOT NULL,
	`serviceType` enum('wms','wfs') NOT NULL,
	`sourceClass` enum('official','approved_custom') NOT NULL DEFAULT 'official',
	`endpoint` varchar(1000) NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`status` enum('draft','validated','published','degraded','unhealthy','disabled') NOT NULL DEFAULT 'draft',
	`enabled` boolean NOT NULL DEFAULT false,
	`health` enum('healthy','timeout','tls_error','http_error','invalid_capabilities','blocked') NOT NULL DEFAULT 'blocked',
	`lastValidatedAt` timestamp,
	`lastHealthyAt` timestamp,
	`lastError` varchar(500),
	`capabilities` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ogc_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `ogc_endpoint_hash_unique` UNIQUE(`endpointHash`)
);
--> statement-breakpoint
CREATE INDEX `ogc_variant_service_idx` ON `ogc_catalog_variants` (`serviceId`);--> statement-breakpoint
CREATE INDEX `ogc_status_idx` ON `ogc_services` (`status`,`enabled`);
