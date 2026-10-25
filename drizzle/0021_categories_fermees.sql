CREATE TABLE `closed_categories` (
	`competition_id` text NOT NULL,
	`age_band_code` text NOT NULL,
	`sex` text NOT NULL,
	`discipline` text NOT NULL,
	`ruleset` text DEFAULT '' NOT NULL,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `age_band_code`, `sex`, `discipline`, `ruleset`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `closed_categories` (`competition_id`, `age_band_code`, `sex`, `discipline`, `ruleset`)
SELECT b.`competition_id`, b.`code`, s.sex, c.discipline, c.ruleset
FROM `age_bands` b
CROSS JOIN (SELECT 'F' AS sex UNION ALL SELECT 'M') s
CROSS JOIN (
  SELECT 'karate' AS discipline, 'jiyu' AS ruleset UNION ALL SELECT 'karate', 'shobu'
  UNION ALL SELECT 'shido-boxing', 'jiyu' UNION ALL SELECT 'shido-boxing', 'shobu'
  UNION ALL SELECT 'shido-mix', 'jiyu' UNION ALL SELECT 'shido-mix', 'shobu'
  UNION ALL SELECT 'triathlon', 'jiyu' UNION ALL SELECT 'triathlon', 'shobu'
  UNION ALL SELECT 'kata', ''
) c
WHERE b.`on_club_form` = 0 AND NOT (b.`is_minor` = 1 AND c.ruleset = 'shobu');
