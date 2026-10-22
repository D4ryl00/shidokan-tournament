CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `zone_id` text REFERENCES zones(id) ON DELETE set null;--> statement-breakpoint
-- Reprise des données : les N tatamis d'une compétition deviennent les zones « Tatami 1 » … « Tatami N »,
-- et une catégorie affectée au tatami k passe sur la zone « Tatami k ».
WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 20)
INSERT INTO `zones` (`id`, `competition_id`, `name`, `sort_order`)
  SELECT c.`id` || ':z' || n.k, c.`id`, 'Tatami ' || n.k, n.k - 1 FROM `competitions` c JOIN n ON n.k <= c.`tatami_count`;--> statement-breakpoint
UPDATE `categories` SET `zone_id` = `competition_id` || ':z' || `tatami`
  WHERE `tatami` IS NOT NULL AND EXISTS (SELECT 1 FROM `zones` z WHERE z.`id` = `categories`.`competition_id` || ':z' || `categories`.`tatami`);