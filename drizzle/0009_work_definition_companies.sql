CREATE TABLE IF NOT EXISTS `work_definition_companies` (
  `work_definition_id` integer NOT NULL,
  `company_id` integer NOT NULL,
  PRIMARY KEY (`work_definition_id`,`company_id`),
  FOREIGN KEY (`work_definition_id`) REFERENCES `work_definitions`(`id`) ON DELETE cascade,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE cascade
);
