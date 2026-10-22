CREATE TABLE `waves` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`rules_json` text NOT NULL,
	`weigh_in_closed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `wave_override` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `presence` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
-- Reprise des données : la présence du combattant devient celle de chacune de ses inscriptions.
UPDATE `registrations` SET `presence` = coalesce((SELECT f.`presence` FROM `fighters` f WHERE f.`id` = `registrations`.`fighter_id`), 'unknown');