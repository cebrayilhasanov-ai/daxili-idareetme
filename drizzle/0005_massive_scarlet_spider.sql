DROP TABLE `work_catalog`;--> statement-breakpoint
CREATE TABLE `work_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`employee_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
