CREATE TABLE `age_bands` (
	`competition_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`min_age` integer NOT NULL,
	`max_age` integer,
	`is_minor` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`competition_id`, `code`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `age_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` text NOT NULL,
	`from_code` text NOT NULL,
	`to_code` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`location` text,
	`tatami_count` integer DEFAULT 2 NOT NULL,
	`settings_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_classes` (
	`competition_id` text NOT NULL,
	`id` text NOT NULL,
	`age_band_code` text NOT NULL,
	`sex` text NOT NULL,
	`label` text NOT NULL,
	`max_kg` real,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`competition_id`, `id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
