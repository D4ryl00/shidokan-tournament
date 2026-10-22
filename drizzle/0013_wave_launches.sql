CREATE TABLE `frozen_passages` (
	`competition_id` text NOT NULL,
	`wave_key` text NOT NULL,
	`zone_id` text NOT NULL,
	`number` integer NOT NULL,
	`category_id` text NOT NULL,
	`match_id` text NOT NULL,
	`no_rest` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`competition_id`, `wave_key`, `category_id`, `match_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wave_launches` (
	`competition_id` text NOT NULL,
	`wave_key` text NOT NULL,
	`launched` integer NOT NULL,
	`restart_numbering` integer DEFAULT false NOT NULL,
	`launched_at` text NOT NULL,
	PRIMARY KEY(`competition_id`, `wave_key`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `numbers_updated_at` text;