CREATE TABLE `grid_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`grid_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kata_scores` (
	`competition_id` text NOT NULL,
	`category_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`round` text NOT NULL,
	`notes_json` text NOT NULL,
	PRIMARY KEY(`category_id`, `registration_id`, `round`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `match_results` (
	`competition_id` text NOT NULL,
	`category_id` text NOT NULL,
	`match_id` text NOT NULL,
	`winner` text NOT NULL,
	`method` text NOT NULL,
	`score` text,
	`entrant_a` text NOT NULL,
	`entrant_b` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`category_id`, `match_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tie_breaks` (
	`competition_id` text NOT NULL,
	`category_id` text NOT NULL,
	`scope` text NOT NULL,
	`order_json` text NOT NULL,
	PRIMARY KEY(`category_id`, `scope`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
