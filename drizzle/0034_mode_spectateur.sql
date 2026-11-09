ALTER TABLE `competitions` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `fighters` ADD `public_name_hidden` integer DEFAULT false NOT NULL;