-- İlkin sınaq üçün yaradılmış tapşırıqları təmizlə.
DELETE FROM `tasks`;
--> statement-breakpoint
-- Zamin Nağıyev yenidən yaradılacağı üçün ona bağlı qeydləri sil.
DELETE FROM `app_sessions`
WHERE `user_id` IN (
	SELECT `id` FROM `app_users`
	WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev')
);
--> statement-breakpoint
DELETE FROM `chat_members`
WHERE `user_id` IN (
	SELECT `id` FROM `app_users`
	WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev')
);
--> statement-breakpoint
DELETE FROM `app_users`
WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev');
--> statement-breakpoint
DELETE FROM `work_catalog_companies`
WHERE `work_item_id` IN (
	SELECT `id` FROM `work_catalog`
	WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev')
);
--> statement-breakpoint
DELETE FROM `work_catalog`
WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev');
--> statement-breakpoint
DELETE FROM `recurring_tasks`
WHERE `employee_id` IN (SELECT `id` FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev');
--> statement-breakpoint
DELETE FROM `employees` WHERE trim(`name`) = 'Zamin Nağıyev';
