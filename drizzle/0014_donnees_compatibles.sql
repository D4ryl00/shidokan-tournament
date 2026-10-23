CREATE TABLE `change_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `club_directory` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`affiliation_number` text,
	`ffk_entity` text,
	`coach_name` text,
	`coach_phone` text,
	`coach_email` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_directory_affiliation_number_unique` ON `club_directory` (`affiliation_number`);--> statement-breakpoint
CREATE INDEX `club_directory_name_key` ON `club_directory` (`name_key`);--> statement-breakpoint
CREATE TABLE `instance` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `age_bands` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `age_bands` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `age_links` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `age_links` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `categories` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `clubs` ADD `directory_club_id` text REFERENCES club_directory(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `clubs` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `clubs` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `owner_instance_id` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `last_sync_at` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `club_entry_status` text DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `club_entry_deadline` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `fighters` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `fighters` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `frozen_passages` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `frozen_passages` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `kata_scores` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `kata_scores` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `match_results` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `match_results` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `recasements` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `recasements` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `refusals` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `refusals` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `registrations` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `tie_breaks` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `tie_breaks` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `wave_launches` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `wave_launches` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `waves` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `waves` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `weight_classes` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `weight_classes` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `zones` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `zones` ADD `updated_at` text;