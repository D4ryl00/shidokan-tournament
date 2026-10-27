ALTER TABLE `club_directory` ADD `coach_emails` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `clubs` ADD `coach_emails` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `club_directory` SET `coach_emails` = json_array(trim(`coach_email`)) WHERE trim(coalesce(`coach_email`, '')) <> '';--> statement-breakpoint
UPDATE `clubs` SET `coach_emails` = json_array(trim(`coach_email`)) WHERE trim(coalesce(`coach_email`, '')) <> '';--> statement-breakpoint
ALTER TABLE `club_directory` DROP COLUMN `coach_email`;--> statement-breakpoint
ALTER TABLE `clubs` DROP COLUMN `coach_email`;
