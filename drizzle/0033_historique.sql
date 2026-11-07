CREATE TABLE `history_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`kind` text NOT NULL,
	`group_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`undone_at` text,
	`wave_id` text,
	`summary_json` text NOT NULL,
	`recasement_ids` text DEFAULT '[]' NOT NULL,
	`category_ids` text DEFAULT '[]' NOT NULL,
	`before_json` text DEFAULT '{"categories":[],"created":[],"registrations":[]}' NOT NULL,
	`after_members_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer,
	`updated_at` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Reprise de l'ancien journal des réaffectations (même ordre : rowid croissant).
INSERT INTO `history_entries` (`id`, `competition_id`, `kind`, `status`, `wave_id`, `summary_json`, `recasement_ids`, `created_at`)
SELECT 'h-' || `id`, `competition_id`,
  CASE WHEN `type` = 'M' THEN 'manual' WHEN `type` = 'W' THEN 'withdraw' WHEN `bulk` = 1 THEN 'plan' ELSE 'reaffectation' END,
  CASE WHEN `status` = 'undone' THEN 'undone' ELSE 'active' END,
  `wave_id`,
  json_object('registrationIds', json_array(`registration_id`), 'fromLabel', `from_label`, 'toLabel', `to_label`, 'reason', `reason`),
  json_array(`id`), `created_at`
FROM `recasements` ORDER BY `rowid`;
