CREATE TABLE `chat_members` (
	`thread_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`last_read_message_id` integer DEFAULT 0 NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`sender_user_id` integer NOT NULL,
	`body` text,
	`attachment_key` text,
	`attachment_name` text,
	`attachment_size` integer,
	`attachment_type` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`direct_key` text,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_threads_direct_key_unique` ON `chat_threads` (`direct_key`);--> statement-breakpoint
