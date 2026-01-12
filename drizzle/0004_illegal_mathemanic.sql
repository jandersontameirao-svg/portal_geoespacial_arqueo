CREATE TABLE `base_layers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`source` enum('funai','incra','icmbio','osm','aneel','custom') NOT NULL,
	`layerType` enum('terras_indigenas','terras_quilombolas','unidades_conservacao','rodovias','infraestrutura_eletrica','other') NOT NULL,
	`dataFormat` enum('geojson','shapefile','kml','wfs') NOT NULL,
	`dataUrl` text,
	`s3Key` varchar(500),
	`featureCount` int,
	`crs` varchar(50) NOT NULL DEFAULT 'EPSG:4674',
	`bounds` json,
	`lastDownloadAt` timestamp,
	`lastUpdateAt` timestamp,
	`cacheExpiresAt` timestamp,
	`downloadStatus` enum('pending','downloading','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `base_layers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `source_idx` ON `base_layers` (`source`);--> statement-breakpoint
CREATE INDEX `layer_type_idx` ON `base_layers` (`layerType`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `base_layers` (`downloadStatus`);