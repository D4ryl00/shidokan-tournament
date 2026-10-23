CREATE TABLE `received_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`from_instance_id` text NOT NULL,
	`from_name` text NOT NULL,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`package_json` text NOT NULL,
	`version` integer,
	`updated_at` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_tokens_token_hash_unique` ON `sync_tokens` (`token_hash`);--> statement-breakpoint
ALTER TABLE `competitions` ADD `owner_name` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `owner_since` text;