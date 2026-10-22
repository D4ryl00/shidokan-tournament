CREATE TABLE `recasements` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`type` text NOT NULL,
	`from_label` text NOT NULL,
	`to_label` text NOT NULL,
	`manual` integer NOT NULL,
	`pre_approved` integer NOT NULL,
	`bulk` integer NOT NULL,
	`status` text DEFAULT 'validated' NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `refusals` (
	`competition_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	PRIMARY KEY(`competition_id`, `proposal_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `alias_keys` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `weigh_in_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `fighters` ADD `presence` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `fighters` ADD `weigh_in_kg` real;--> statement-breakpoint
ALTER TABLE `registrations` ADD `original_json` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `recasement_type` text;