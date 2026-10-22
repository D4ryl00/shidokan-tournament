CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`key_string` text NOT NULL,
	`key_json` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`format` text,
	`repechage` integer,
	`third_place` integer,
	`seed` integer NOT NULL,
	`bracket_json` text,
	`stale` integer DEFAULT false NOT NULL,
	`tatami` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `registrations` ADD `category_id` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `placement_locked` integer DEFAULT false NOT NULL;