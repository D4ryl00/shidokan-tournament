ALTER TABLE `clubs` ADD `invited_at` text;--> statement-breakpoint
UPDATE `clubs` SET `invited_at` = (SELECT min(`i`.`created_at`) FROM `club_invitations` `i` WHERE `i`.`club_id` = `clubs`.`id` AND `i`.`revoked_at` IS NULL) WHERE EXISTS (SELECT 1 FROM `club_invitations` `i` WHERE `i`.`club_id` = `clubs`.`id` AND `i`.`revoked_at` IS NULL);
