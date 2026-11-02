ALTER TABLE `base_layers` ADD `refreshFailureCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `base_layers` ADD `lastRefreshAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `base_layers` ADD `retryAfter` timestamp;