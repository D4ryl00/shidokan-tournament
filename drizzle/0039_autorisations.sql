CREATE TABLE `authorization_answers` (
	`competition_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`kind` text NOT NULL,
	`situation_json` text NOT NULL,
	`answered_at` text NOT NULL,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `registration_id`, `kind`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON UPDATE no action ON DELETE cascade
);
