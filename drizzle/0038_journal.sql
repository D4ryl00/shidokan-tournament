CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`seq` integer NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`via` text NOT NULL,
	`at` text NOT NULL,
	`client_at` text,
	`actor_json` text NOT NULL,
	`data_json` text NOT NULL,
	`search_text` text NOT NULL,
	`version` integer,
	`updated_at` text,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_seq` ON `journal_entries` (`competition_id`,`seq`);--> statement-breakpoint
CREATE INDEX `journal_entries_parent` ON `journal_entries` (`competition_id`,`parent_id`);--> statement-breakpoint
-- « Journal ouvert » : un point de départ pour chaque compétition tenue ici (les compétitions importées d'un autre poste n'ont pas de journal local).
INSERT INTO `journal_entries` (`id`, `competition_id`, `seq`, `parent_id`, `type`, `action`, `via`, `at`, `client_at`, `actor_json`, `data_json`, `search_text`)
SELECT lower(hex(randomblob(16))), `id`, 1, NULL, 'competition', 'journal-opened', 'autre', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, '{"kind":"app"}', '{}', 'JOURNAL OUVERT CE QUI A ETE FAIT AVANT N Y FIGURE PAS L APPLI AUTRE'
FROM `competitions` WHERE `owner_instance_id` IS NULL;
