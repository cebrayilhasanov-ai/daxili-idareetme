ALTER TABLE `recurring_tasks` ADD `frequency` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_tasks` ADD `weekday` integer;--> statement-breakpoint
ALTER TABLE `recurring_tasks` ADD `due_time` text DEFAULT '14:00' NOT NULL;