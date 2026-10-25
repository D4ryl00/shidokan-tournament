CREATE TABLE `set_aside_cases` (
	`competition_id` text NOT NULL,
	`case_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `case_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `registrations` ADD `withdrawn_reason` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `withdrawn_entry` text;