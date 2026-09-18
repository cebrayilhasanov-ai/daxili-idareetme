CREATE TABLE `work_assignment_completions` (
  `work_assignment_id` integer NOT NULL,
  `period_key` text NOT NULL,
  `completed_at` text NOT NULL,
  PRIMARY KEY (`work_assignment_id`, `period_key`),
  FOREIGN KEY (`work_assignment_id`) REFERENCES `work_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
