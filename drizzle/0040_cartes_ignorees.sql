CREATE TABLE `ignored_cases` (
	`competition_id` text NOT NULL,
	`case_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`wave_id` text,
	`history_entry_id` text NOT NULL,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `case_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
