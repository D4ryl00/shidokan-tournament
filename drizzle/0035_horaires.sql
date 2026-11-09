CREATE TABLE `wave_schedules` (
	`competition_id` text NOT NULL,
	`wave_key` text NOT NULL,
	`planned_start` text,
	`actual_start` text,
	`finals_start` text,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `wave_key`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `durations_json` text;