CREATE TABLE `work_catalog_companies` (
	`work_item_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	PRIMARY KEY(`work_item_id`, `company_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
