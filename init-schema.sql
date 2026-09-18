CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'İşçi',
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  employee_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_day INTEGER NOT NULL DEFAULT 25,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  weekday INTEGER,
  due_time TEXT NOT NULL DEFAULT '14:00',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  employee_id INTEGER NOT NULL,
  recurring_task_id INTEGER,
  period_key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Yeni',
  evaluation INTEGER,
  evaluation_note TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (recurring_task_id) REFERENCES recurring_tasks(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurring_period_unique ON tasks (recurring_task_id, period_key);

CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  direct_key TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_direct_key_unique ON chat_threads (direct_key);

CREATE TABLE IF NOT EXISTS chat_members (
  thread_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id),
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  thread_id INTEGER NOT NULL,
  sender_user_id INTEGER NOT NULL,
  body TEXT,
  attachment_key TEXT,
  attachment_name TEXT,
  attachment_size INTEGER,
  attachment_type TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  title TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  employee_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS work_catalog_companies (
  work_item_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  PRIMARY KEY (work_item_id, company_id),
  FOREIGN KEY (work_item_id) REFERENCES work_catalog(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_assignment_completions (
  work_assignment_id INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (work_assignment_id, period_key),
  FOREIGN KEY (work_assignment_id) REFERENCES work_assignments(id) ON DELETE CASCADE
);
