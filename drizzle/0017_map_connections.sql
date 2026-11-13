CREATE TABLE `map_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('WMS','WFS','ArcGIS REST','GeoJSON','PostGIS') NOT NULL,
	`address` varchar(500) NOT NULL,
	`layer` varchar(150) NOT NULL DEFAULT '',
	`enabled` boolean NOT NULL DEFAULT false,
	`createdById` int,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `map_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `map_connections_enabled_idx` ON `map_connections` (`enabled`);