CREATE TABLE `club_aliases` (
	`name_key` text PRIMARY KEY NOT NULL,
	`club_entity` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_mappings` (
	`signature` text PRIMARY KEY NOT NULL,
	`mapping_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`file_name` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `registrations` ADD `ffk_confirmed` integer DEFAULT false NOT NULL;