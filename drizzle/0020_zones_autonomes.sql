CREATE TABLE `zone_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`from_instance_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`zone_name` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`category_id` text NOT NULL,
	`target_key` text NOT NULL,
	`entry_json` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`own_revs_json` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text,
	`version` integer,
	`updated_at` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `zone_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`category_id` text NOT NULL,
	`target_key` text NOT NULL,
	`entry_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`sent_at` text,
	`version` integer,
	`updated_at` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
