ALTER TABLE `competitions` ADD `server_fingerprint` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `rescue_since` text;--> statement-breakpoint
ALTER TABLE `users` ADD `competition_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `zone_id` text;