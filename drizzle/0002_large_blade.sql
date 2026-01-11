CREATE TABLE `geometries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('marker','polyline','polygon') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`coordinates` text NOT NULL,
	`color` varchar(7) DEFAULT '#3b82f6',
	`visible` int NOT NULL DEFAULT 1,
	`opacity` int NOT NULL DEFAULT 100,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `geometries_id` PRIMARY KEY(`id`)
);
