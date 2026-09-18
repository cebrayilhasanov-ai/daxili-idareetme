CREATE TABLE `work_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`created_at` text NOT NULL
);
