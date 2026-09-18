CREATE TABLE IF NOT EXISTS `work_definitions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `frequency` text DEFAULT 'monthly' NOT NULL,
  `created_at` text NOT NULL
);
CREATE TABLE IF NOT EXISTS `work_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `work_definition_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `company_id` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`work_definition_id`) REFERENCES `work_definitions`(`id`) ON DELETE cascade,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`),
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `work_assignments_unique` ON `work_assignments` (`work_definition_id`,`employee_id`,`company_id`);
