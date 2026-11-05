CREATE TABLE `club_changes` (
	`club_id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`directory_id` text NOT NULL,
	`origin` text NOT NULL,
	`values_json` text NOT NULL,
	`changed_at` text NOT NULL,
	`ignored` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`directory_id`) REFERENCES `club_directory`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `clubs` ADD `affiliation_number` text;