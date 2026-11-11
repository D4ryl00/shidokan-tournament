CREATE TABLE `wave_finals` (
	`competition_id` text NOT NULL,
	`wave_key` text NOT NULL,
	`finals_zone_id` text,
	`where_default` text,
	`when_default` text,
	`version` integer,
	`updated_at` text,
	PRIMARY KEY(`competition_id`, `wave_key`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finals_zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `finals_where` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `finals_when` text;--> statement-breakpoint
ALTER TABLE `frozen_passages` ADD `finals_choice` text;--> statement-breakpoint
INSERT INTO `wave_finals` (`competition_id`, `wave_key`, `finals_zone_id`)
SELECT c.`id`, coalesce(w.`id`, ''), z.`id`
FROM `competitions` c
JOIN `zones` z ON z.`competition_id` = c.`id`
  AND z.`id` = (CASE WHEN json_valid(c.`settings_json`) THEN json_extract(c.`settings_json`, '$.finalsZoneId') END)
LEFT JOIN `waves` w ON w.`competition_id` = c.`id`;
--> statement-breakpoint
UPDATE `categories` SET `finals_where` = 'own', `finals_when` = 'ready'
WHERE (CASE WHEN json_valid(`key_json`) THEN json_extract(`key_json`, '$.discipline') END) = 'kata'
  AND `competition_id` IN (SELECT `competition_id` FROM `wave_finals`)
  AND `competition_id` IN (
    SELECT `id` FROM `competitions`
    WHERE (CASE WHEN json_valid(`settings_json`) THEN json_extract(`settings_json`, '$.kataFinalsOnFinalsZone') END) IS NOT 1
  );
