CREATE TABLE `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`ffk_entity` text,
	`coach_name` text,
	`coach_phone` text,
	`coach_email` text,
	`pre_approval` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fighters` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`club_id` text,
	`last_name` text NOT NULL,
	`first_name` text NOT NULL,
	`name_key` text NOT NULL,
	`sex` text NOT NULL,
	`age_band_code` text NOT NULL,
	`licence` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`fighter_id` text NOT NULL,
	`discipline` text NOT NULL,
	`ruleset` text,
	`weight_class_id` text,
	`approx_weight_kg` real,
	`other_disciplines_json` text DEFAULT '[]' NOT NULL,
	`accepts_jiyu_first` integer,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fighter_id`) REFERENCES `fighters`(`id`) ON UPDATE no action ON DELETE cascade
);
