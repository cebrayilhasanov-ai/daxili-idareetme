CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` text DEFAULT 'İşçi' NOT NULL,
	`email` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_day` integer DEFAULT 25 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`recurring_task_id` integer,
	`period_key` text,
	`title` text NOT NULL,
	`description` text,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'Yeni' NOT NULL,
	`evaluation` integer,
	`evaluation_note` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_task_id`) REFERENCES `recurring_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_recurring_period_unique` ON `tasks` (`recurring_task_id`,`period_key`);