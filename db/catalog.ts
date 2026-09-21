import { env } from "@/lib/runtime";

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL UNIQUE,
    active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  const columns = await db().prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "company_id")) {
    await db().prepare("ALTER TABLE tasks ADD COLUMN company_id INTEGER REFERENCES companies(id)").run();
  }
  if (!columns.results.some((column) => column.name === "employee_status_changed")) {
    await db().prepare("ALTER TABLE tasks ADD COLUMN employee_status_changed INTEGER DEFAULT 0 NOT NULL").run();
  }
  if (!columns.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE tasks ADD COLUMN attachment_key TEXT").run();
  if (!columns.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE tasks ADD COLUMN attachment_name TEXT").run();
  if (!columns.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE tasks ADD COLUMN attachment_size INTEGER").run();
  if (!columns.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE tasks ADD COLUMN attachment_type TEXT").run();
  if (!columns.results.some((column) => column.name === "submission_attachment_key")) await db().prepare("ALTER TABLE tasks ADD COLUMN submission_attachment_key TEXT").run();
  if (!columns.results.some((column) => column.name === "submission_attachment_name")) await db().prepare("ALTER TABLE tasks ADD COLUMN submission_attachment_name TEXT").run();
  if (!columns.results.some((column) => column.name === "submission_attachment_size")) await db().prepare("ALTER TABLE tasks ADD COLUMN submission_attachment_size INTEGER").run();
  if (!columns.results.some((column) => column.name === "submission_attachment_type")) await db().prepare("ALTER TABLE tasks ADD COLUMN submission_attachment_type TEXT").run();
  if (!columns.results.some((column) => column.name === "overdue_notified_at")) await db().prepare("ALTER TABLE tasks ADD COLUMN overdue_notified_at TEXT").run();
  if (!columns.results.some((column) => column.name === "original_due_at")) {
    await db().prepare("ALTER TABLE tasks ADD COLUMN original_due_at TEXT").run();
    await db().prepare("UPDATE tasks SET original_due_at = due_at WHERE original_due_at IS NULL").run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS task_date_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    proposed_due_at TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Gözləyir',
    admin_note TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS task_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS document_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    template1_key TEXT,
    template1_name TEXT,
    template1_size INTEGER,
    template1_type TEXT,
    template2_key TEXT,
    template2_name TEXT,
    template2_size INTEGER,
    template2_type TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const documentColumns = await db().prepare("PRAGMA table_info(document_templates)").all<{ name: string }>();
  if (!documentColumns.results.some((column) => column.name === "template3_key")) await db().prepare("ALTER TABLE document_templates ADD COLUMN template3_key TEXT").run();
  if (!documentColumns.results.some((column) => column.name === "template3_name")) await db().prepare("ALTER TABLE document_templates ADD COLUMN template3_name TEXT").run();
  if (!documentColumns.results.some((column) => column.name === "template3_size")) await db().prepare("ALTER TABLE document_templates ADD COLUMN template3_size INTEGER").run();
  if (!documentColumns.results.some((column) => column.name === "template3_type")) await db().prepare("ALTER TABLE document_templates ADD COLUMN template3_type TEXT").run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS outgoing_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    outgoing_no TEXT NOT NULL,
    outgoing_date TEXT,
    incoming_no TEXT,
    incoming_date TEXT,
    sending_department TEXT,
    document_type TEXT,
    sending_method TEXT,
    delivered_by TEXT,
    copies TEXT,
    document_number TEXT,
    document_date TEXT,
    voen TEXT,
    organization_name TEXT,
    phone TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    entity_type TEXT,
    voen TEXT,
    name TEXT NOT NULL,
    legal_address TEXT,
    legal_address2 TEXT,
    manager TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const outgoingColumns = await db().prepare("PRAGMA table_info(outgoing_documents)").all<{ name: string }>();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_key TEXT").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_name TEXT").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_size INTEGER").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_type TEXT").run();
  const personalWorksColumns = await db().prepare("PRAGMA table_info(personal_works)").all<{ name: string }>();
  if (personalWorksColumns.results.length && !personalWorksColumns.results.some((column) => column.name === "user_id")) {
    // Migrate old employee_id-owned personal_works to user_id ownership (so admins, who have no employee record, can own works too).
    await db().prepare(`CREATE TABLE personal_works_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER REFERENCES app_users(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'Yeni',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`).run();
    await db().prepare(`INSERT INTO personal_works_new (id, user_id, title, description, status, created_at, completed_at)
      SELECT personal_works.id, app_users.id, personal_works.title, personal_works.description, personal_works.status, personal_works.created_at, personal_works.completed_at
      FROM personal_works LEFT JOIN app_users ON app_users.employee_id = personal_works.employee_id`).run();
    await db().prepare("DROP TABLE personal_works").run();
    await db().prepare("ALTER TABLE personal_works_new RENAME TO personal_works").run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS personal_works (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES app_users(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Yeni',
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`).run();
  const personalWorksColumns2 = await db().prepare("PRAGMA table_info(personal_works)").all<{ name: string }>();
  if (!personalWorksColumns2.results.some((column) => column.name === "company_id")) await db().prepare("ALTER TABLE personal_works ADD COLUMN company_id INTEGER REFERENCES companies(id)").run();
  if (!personalWorksColumns2.results.some((column) => column.name === "due_at")) await db().prepare("ALTER TABLE personal_works ADD COLUMN due_at TEXT").run();
  if (!personalWorksColumns2.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE personal_works ADD COLUMN attachment_key TEXT").run();
  if (!personalWorksColumns2.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE personal_works ADD COLUMN attachment_name TEXT").run();
  if (!personalWorksColumns2.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE personal_works ADD COLUMN attachment_size INTEGER").run();
  if (!personalWorksColumns2.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE personal_works ADD COLUMN attachment_type TEXT").run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS personal_work_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    personal_work_id INTEGER NOT NULL REFERENCES personal_works(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  const checklistItemColumns = await db().prepare("PRAGMA table_info(personal_work_checklist_items)").all<{ name: string }>();
  if (!checklistItemColumns.results.some((column) => column.name === "delegated_task_id")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN delegated_task_id INTEGER REFERENCES tasks(id)").run();
  if (!checklistItemColumns.results.some((column) => column.name === "delegated_employee_id")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN delegated_employee_id INTEGER REFERENCES employees(id)").run();
  if (!checklistItemColumns.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN attachment_key TEXT").run();
  if (!checklistItemColumns.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN attachment_name TEXT").run();
  if (!checklistItemColumns.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN attachment_size INTEGER").run();
  if (!checklistItemColumns.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN attachment_type TEXT").run();
  const employeeColumns = await db().prepare("PRAGMA table_info(employees)").all<{ name: string }>();
  if (!employeeColumns.results.some((column) => column.name === "avatar_key")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN avatar_key TEXT").run();
  }
  const companyColumns = await db().prepare("PRAGMA table_info(companies)").all<{ name: string }>();
  if (!companyColumns.results.some((column) => column.name === "voen")) {
    await db().prepare("ALTER TABLE companies ADD COLUMN voen TEXT").run();
  }
  if (!companyColumns.results.some((column) => column.name === "manager")) {
    await db().prepare("ALTER TABLE companies ADD COLUMN manager TEXT").run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS work_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    frequency TEXT DEFAULT 'monthly' NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  const workDefinitionColumns = await db().prepare("PRAGMA table_info(work_definitions)").all<{ name: string }>();
  if (!workDefinitionColumns.results.some((column) => column.name === "description")) {
    await db().prepare("ALTER TABLE work_definitions ADD COLUMN description TEXT").run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS work_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    work_definition_id INTEGER NOT NULL REFERENCES work_definitions(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    created_at TEXT NOT NULL,
    UNIQUE(work_definition_id, employee_id, company_id)
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS work_definition_companies (
    work_definition_id INTEGER NOT NULL REFERENCES work_definitions(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY(work_definition_id, company_id)
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS employee_companies (
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY(employee_id, company_id)
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS employee_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    note TEXT,
    created_by_name TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const violationColumns = await db().prepare("PRAGMA table_info(employee_violations)").all<{ name: string }>();
  if (!violationColumns.results.some((column) => column.name === "company_id")) {
    await db().prepare("ALTER TABLE employee_violations ADD COLUMN company_id INTEGER REFERENCES companies(id)").run();
  }
  const migrated = await db().prepare("SELECT COUNT(*) AS count FROM work_definitions").first<{count:number}>();
  if (!migrated?.count) {
    await db().prepare(`INSERT INTO work_definitions (title, frequency, created_at)
      SELECT title, frequency, MIN(created_at) FROM work_catalog GROUP BY title, frequency`).run();
    await db().prepare(`INSERT OR IGNORE INTO work_assignments (work_definition_id, employee_id, company_id, created_at)
      SELECT d.id, c.employee_id, cc.company_id, c.created_at
      FROM work_catalog c
      JOIN work_definitions d ON d.title = c.title AND d.frequency = c.frequency
      JOIN work_catalog_companies cc ON cc.work_item_id = c.id`).run();
    await db().prepare(`INSERT OR IGNORE INTO work_definition_companies (work_definition_id, company_id)
      SELECT d.id, cc.company_id FROM work_catalog c
      JOIN work_definitions d ON d.title = c.title AND d.frequency = c.frequency
      JOIN work_catalog_companies cc ON cc.work_item_id = c.id`).run();
  }
  schemaReady = true;
}

function dateKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthlyDueAt(day: number, time = "14:00", date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month, Math.min(Math.max(day, 1), lastDay), hour || 0, minute || 0)).toISOString();
}

function mondayOfWeek(date = new Date()) {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
}

function dueAtFor(item: { frequency:string; due_day:number; weekday:number|null; due_time:string }, now = new Date()) {
  if (item.frequency === "daily") {
    const [hour,minute] = item.due_time.split(":").map(Number);
    return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),hour||0,minute||0)).toISOString();
  }
  if (item.frequency === "weekly") {
    const monday = mondayOfWeek(now);
    const [hour,minute] = item.due_time.split(":").map(Number);
    return new Date(Date.UTC(monday.getUTCFullYear(),monday.getUTCMonth(),monday.getUTCDate()+Math.max(1,Math.min(item.weekday||1,7))-1,hour||0,minute||0)).toISOString();
  }
  return monthlyDueAt(item.due_day,item.due_time,now);
}

function periodKey(item:{frequency:string}, now=new Date()) {
  if (item.frequency === "daily") return `daily:${dateKey(now)}`;
  if (item.frequency === "weekly") return `weekly:${dateKey(mondayOfWeek(now))}`;
  return `monthly:${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}`;
}

async function ensureRecurringTasks() {
  const recurring = await db().prepare(
    "SELECT id, employee_id, title, description, due_day, frequency, weekday, due_time FROM recurring_tasks WHERE active = 1",
  ).all<{ id: number; employee_id: number; title: string; description: string | null; due_day: number; frequency:string; weekday:number|null; due_time:string }>();
  for (const item of recurring.results) {
    const period = periodKey(item);
    await db().prepare(
      `INSERT OR IGNORE INTO tasks
       (employee_id, recurring_task_id, period_key, title, description, due_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?)`,
    ).bind(item.employee_id, item.id, period, item.title, item.description, dueAtFor(item), new Date().toISOString()).run();
  }
}

export async function getAllData() {
  await ensureSchema();
  await ensureRecurringTasks();
  const [employees, companies, recurring, workItems, workAssignments, workCompletions, tasks, dateRequests] = await Promise.all([
    db().prepare(`SELECT employees.*,
      (SELECT group_concat(company_id) FROM employee_companies WHERE employee_id = employees.id) AS company_ids
      FROM employees ORDER BY active DESC, name`).all(),
    db().prepare("SELECT * FROM companies ORDER BY active DESC, name").all(),
    db().prepare(`SELECT recurring_tasks.*, employees.name AS employee_name
      FROM recurring_tasks JOIN employees ON employees.id = recurring_tasks.employee_id
      ORDER BY recurring_tasks.active DESC, recurring_tasks.id DESC`).all(),
    db().prepare(`SELECT work_definitions.*,
      (SELECT group_concat(company_id) FROM work_definition_companies WHERE work_definition_id = work_definitions.id) AS company_ids
      FROM work_definitions ORDER BY id DESC`).all(),
    db().prepare(`SELECT a.*, d.title, d.description, d.frequency, e.name AS employee_name, c.name AS company_name
      FROM work_assignments a
      JOIN work_definitions d ON d.id = a.work_definition_id
      JOIN employees e ON e.id = a.employee_id
      JOIN companies c ON c.id = a.company_id
      ORDER BY a.id DESC`).all(),
    db().prepare("SELECT work_assignment_id, period_key FROM work_assignment_completions").all<{work_assignment_id:number;period_key:string}>(),
    db().prepare(`SELECT tasks.*, employees.name AS employee_name, employees.position AS employee_position,
      companies.name AS company_name
      FROM tasks JOIN employees ON employees.id = tasks.employee_id
      LEFT JOIN companies ON companies.id = tasks.company_id
      ORDER BY tasks.created_at DESC, tasks.id DESC`).all(),
    db().prepare(`SELECT task_date_requests.*, tasks.title AS task_title, tasks.employee_id AS employee_id, employees.name AS employee_name
      FROM task_date_requests
      JOIN tasks ON tasks.id = task_date_requests.task_id
      JOIN employees ON employees.id = tasks.employee_id
      ORDER BY task_date_requests.created_at DESC`).all(),
  ]);
  const completedKeys = new Set(workCompletions.results.map((item) => `${item.work_assignment_id}:${item.period_key}`));
  const currentAssignments = (workAssignments.results as Array<Record<string, unknown>>).map((item) => {
    const currentPeriod = periodKey({ frequency: String(item.frequency) });
    return { ...item, period_key: currentPeriod, is_completed: Number(completedKeys.has(`${item.id}:${currentPeriod}`)) };
  });
  return { employees: employees.results, companies: companies.results, recurring: recurring.results, workItems: workItems.results, workAssignments: currentAssignments, tasks: tasks.results, dateRequests: dateRequests.results };
}

export async function createWorkItem(input: { title: string; description?: string; frequency?: string }) {
  const title = input.title?.trim();
  const frequency = input.frequency || "monthly";
  if (!title) throw new Error("İşin adını yazın.");
  if (!["monthly", "weekly", "daily"].includes(frequency)) throw new Error("Dövr seçimi düzgün deyil.");
  await db().prepare("INSERT INTO work_definitions (title, description, frequency, created_at) VALUES (?, ?, ?, ?)")
    .bind(title, input.description?.trim() || null, frequency, new Date().toISOString()).run();
}

export async function updateWorkItem(input: { id: number; frequency?: string }) {
  const current = await db().prepare("SELECT frequency FROM work_definitions WHERE id = ?").bind(input.id).first<{frequency:string}>();
  if (!current) throw new Error("İş tapılmadı.");
  const frequency = input.frequency || current.frequency;
  if (!["monthly", "weekly", "daily"].includes(frequency)) throw new Error("Dövr seçimi düzgün deyil.");
  await db().prepare("UPDATE work_definitions SET frequency = ? WHERE id = ?").bind(frequency, input.id).run();
}

export async function toggleWorkDefinitionCompany(input: { id:number; companyId:number; selected:boolean }) {
  if (!input.id || !input.companyId) throw new Error("Sabit iş və firma seçilməlidir.");
  if (input.selected) await db().prepare("INSERT OR IGNORE INTO work_definition_companies (work_definition_id, company_id) VALUES (?, ?)").bind(input.id, input.companyId).run();
  else await db().prepare("DELETE FROM work_definition_companies WHERE work_definition_id = ? AND company_id = ?").bind(input.id, input.companyId).run();
}

export async function createWorkAssignment(input: { workDefinitionId:number; employeeId:number; companyIds:number[] }) {
  const companyIds = Array.isArray(input.companyIds) ? input.companyIds.map(Number).filter(Boolean) : [];
  if (!input.workDefinitionId || !input.employeeId || !companyIds.length) throw new Error("Sabit iş, personal və ən azı bir firma seçilməlidir.");
  for (const companyId of companyIds) {
    await db().prepare("DELETE FROM work_assignments WHERE work_definition_id = ? AND company_id = ?").bind(input.workDefinitionId, companyId).run();
    await db().prepare("INSERT INTO work_assignments (work_definition_id, employee_id, company_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.workDefinitionId, input.employeeId, companyId, new Date().toISOString()).run();
  }
}

export async function toggleWorkAssignment(input: { workDefinitionId:number; employeeId:number; companyId:number; selected:boolean }) {
  if (!input.workDefinitionId || !input.employeeId || !input.companyId) throw new Error("Sabit iş, personal və firma seçilməlidir.");
  if (input.selected) {
    await db().prepare("DELETE FROM work_assignments WHERE work_definition_id = ? AND company_id = ?")
      .bind(input.workDefinitionId, input.companyId).run();
    await db().prepare("INSERT INTO work_assignments (work_definition_id, employee_id, company_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.workDefinitionId, input.employeeId, input.companyId, new Date().toISOString()).run();
  } else {
    await db().prepare("DELETE FROM work_assignments WHERE work_definition_id = ? AND employee_id = ? AND company_id = ?")
      .bind(input.workDefinitionId, input.employeeId, input.companyId).run();
  }
}

export async function completeWorkAssignment(input: { assignmentId:number }, employeeId:number|null) {
  if (!input.assignmentId) throw new Error("Sabit iş seçilməyib.");
  const statement = employeeId
    ? db().prepare(`SELECT a.id, d.frequency FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ? AND a.employee_id = ?`).bind(input.assignmentId, employeeId)
    : db().prepare(`SELECT a.id, d.frequency FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ?`).bind(input.assignmentId);
  const assignment = await statement.first<{id:number;frequency:string}>();
  if (!assignment) throw new Error("Bu sabit iş sizə təyin edilməyib.");
  await db().prepare("INSERT OR IGNORE INTO work_assignment_completions (work_assignment_id, period_key, completed_at) VALUES (?, ?, ?)")
    .bind(assignment.id, periodKey({frequency:assignment.frequency}), new Date().toISOString()).run();
}

export async function createCompany(input: { name: string; voen?: string; manager?: string }) {
  await ensureSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Firmanın adını daxil edin.");
  await db().prepare("INSERT INTO companies (name, voen, manager, active, created_at) VALUES (?, ?, ?, 1, ?)")
    .bind(name, input.voen?.trim() || null, input.manager?.trim() || null, new Date().toISOString()).run();
}

export async function updateCompany(input: { id: number; name?: string; voen?: string; manager?: string; active?: boolean }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM companies WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Firma tapılmadı.");
  await db().prepare("UPDATE companies SET name = ?, voen = ?, manager = ?, active = ? WHERE id = ?")
    .bind(input.name?.trim() || current.name, input.voen === undefined ? current.voen : input.voen.trim() || null, input.manager === undefined ? current.manager : input.manager.trim() || null, input.active === undefined ? current.active : Number(input.active), input.id).run();
}

async function setEmployeeCompanies(employeeId: number, companyIds: number[]) {
  await db().prepare("DELETE FROM employee_companies WHERE employee_id = ?").bind(employeeId).run();
  for (const companyId of companyIds) {
    await db().prepare("INSERT OR IGNORE INTO employee_companies (employee_id, company_id) VALUES (?, ?)").bind(employeeId, companyId).run();
  }
}

export async function createEmployee(input: { name: string; position?: string; email?: string; companyIds?: number[]; avatarKey?: string }) {
  await ensureSchema();
  const result = await db().prepare("INSERT INTO employees (name, position, email, active, avatar_key, created_at) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(input.name, input.position || "Personal", input.email || null, input.avatarKey || null, new Date().toISOString()).run();
  const employeeId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  if (input.companyIds?.length) await setEmployeeCompanies(employeeId, input.companyIds);
  return employeeId;
}

export async function updateEmployee(input: { id: number; name?: string; position?: string; email?: string; active?: boolean; companyIds?: number[]; avatarKey?: string | null }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM employees WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Personal tapılmadı.");
  await db().prepare("UPDATE employees SET name = ?, position = ?, email = ?, active = ?, avatar_key = ? WHERE id = ?")
    .bind(input.name ?? current.name, input.position ?? current.position, input.email ?? current.email, input.active === undefined ? current.active : Number(input.active), input.avatarKey === undefined ? current.avatar_key : input.avatarKey, input.id).run();
  if (input.companyIds !== undefined) await setEmployeeCompanies(input.id, input.companyIds);
}

export async function deleteEmployee(id: number) {
  const employee = await db().prepare("SELECT active FROM employees WHERE id = ?").bind(id).first<{ active: number }>();
  if (!employee) throw new Error("Personal tapılmadı.");
  if (employee.active) throw new Error("Personalı silməzdən əvvəl deaktiv edin.");
  const taskCount = await db().prepare("SELECT COUNT(*) AS count FROM tasks WHERE employee_id = ?").bind(id).first<{ count: number }>();
  const recurringCount = await db().prepare("SELECT COUNT(*) AS count FROM recurring_tasks WHERE employee_id = ?").bind(id).first<{ count: number }>();
  if ((taskCount?.count || 0) > 0 || (recurringCount?.count || 0) > 0)
    throw new Error("Bu personalın tapşırıq və ya aylıq iş tarixçəsi var. Yalnız heç bir işi olmayan personal silinə bilər.");
  await db().prepare("DELETE FROM employees WHERE id = ?").bind(id).run();
}

export async function createTask(input: { employeeId: number; companyId?: number; title: string; description?: string; dueAt: string; attachmentKey?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) {
  await ensureSchema();
  if (input.companyId) {
    const allowed = await db().prepare("SELECT 1 FROM employee_companies WHERE employee_id = ? AND company_id = ?").bind(input.employeeId, input.companyId).first();
    if (!allowed) throw new Error("Bu firma bu personala təyin edilməyib.");
  }
  const recentLimit = new Date(Date.now() - 10_000).toISOString();
  const duplicate = await db().prepare(`SELECT id FROM tasks
    WHERE employee_id = ? AND company_id = ? AND title = ? AND due_at = ? AND created_at >= ?
    LIMIT 1`)
    .bind(input.employeeId, input.companyId || null, input.title, input.dueAt, recentLimit).first();
  if (duplicate) return;
  await db().prepare(`INSERT INTO tasks
    (employee_id, company_id, title, description, due_at, original_due_at, status, created_at, attachment_key, attachment_name, attachment_size, attachment_type) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?, ?, ?, ?, ?)`)
    .bind(input.employeeId, input.companyId || null, input.title, input.description || null, input.dueAt, input.dueAt, new Date().toISOString(), input.attachmentKey || null, input.attachmentName || null, input.attachmentSize || null, input.attachmentType || null).run();
}

export async function createDateChangeRequest(input: { taskId: number; employeeId: number; proposedDueAt: string; reason?: string }) {
  await ensureSchema();
  const task = await db().prepare("SELECT employee_id, due_at, status FROM tasks WHERE id = ?").bind(input.taskId).first<{ employee_id: number; due_at: string; status: string }>();
  if (!task) throw new Error("Tapşırıq tapılmadı.");
  if (task.employee_id !== input.employeeId) throw new Error("Bu tapşırıq sizə aid deyil.");
  if (task.status === "Təsdiqlənib" || task.status === "Təqdim edilib") throw new Error("Bu tapşırıq üçün artıq tarix dəyişikliyi tələb edilə bilməz.");
  const existing = await db().prepare("SELECT id FROM task_date_requests WHERE task_id = ?").bind(input.taskId).first();
  if (existing) throw new Error("Bu tapşırıq üçün tarix dəyişikliyi artıq bir dəfə tələb edilib. Yenidən tələb edilə bilməz.");
  if (!input.proposedDueAt) throw new Error("Təklif olunan tarixi seçin.");
  await db().prepare(`INSERT INTO task_date_requests (task_id, proposed_due_at, reason, status, created_at) VALUES (?, ?, ?, 'Gözləyir', ?)`)
    .bind(input.taskId, input.proposedDueAt, input.reason?.trim() || null, new Date().toISOString()).run();
}

export async function resolveDateChangeRequest(input: { id: number; approve: boolean; adminNote?: string; finalDueAt?: string }) {
  await ensureSchema();
  const request = await db().prepare("SELECT * FROM task_date_requests WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!request) throw new Error("Tələb tapılmadı.");
  if (request.status !== "Gözləyir") throw new Error("Bu tələb artıq həll olunub.");
  const status = input.approve ? "Qəbul edilib" : "Rədd edilib";
  const finalDueAt = input.finalDueAt || String(request.proposed_due_at);
  await db().prepare("UPDATE task_date_requests SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?")
    .bind(status, input.adminNote?.trim() || null, new Date().toISOString(), input.id).run();
  if (input.approve) {
    await db().prepare("UPDATE tasks SET due_at = ? WHERE id = ?").bind(finalDueAt, request.task_id).run();
  }
}

export async function updateTask(input: { id: number; status?: string; evaluation?: number; evaluationNote?: string; userMode?: boolean; submissionAttachmentKey?: string; submissionAttachmentName?: string; submissionAttachmentSize?: number; submissionAttachmentType?: string }) {
  const current = await db().prepare("SELECT * FROM tasks WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Tapşırıq tapılmadı.");
  if (input.userMode) {
    if (current.status !== "Geri qaytarılıb" && new Date(String(current.due_at)).getTime() <= Date.now())
      throw new Error("Tapşırığın son icra tarixi bitib. Status dəyişdirilə bilməz.");
    const changeCount = Number(current.employee_status_changed || 0);
    if (changeCount >= 2) throw new Error("Bu tapşırıq artıq təqdim edilib və status dəyişdirilə bilməz.");
    const validTransition = (current.status === "Yeni" && input.status === "İcradadır") ||
      ((current.status === "İcradadır" || current.status === "Geri qaytarılıb") && input.status === "Təqdim edilib");
    if (!validTransition) throw new Error("Status yalnız “Yeni” → “İcradadır” → “Təqdim edilib” ardıcıllığı ilə dəyişə bilər.");
    if (input.status === "Təqdim edilib" && current.attachment_key && !input.submissionAttachmentKey && !current.submission_attachment_key)
      throw new Error("Tapşırıqla göndərilən faylı doldurub yükləməlisiniz.");
  } else if (input.status === "Təsdiqlənib") {
    const score = Number(input.evaluation);
    if (current.status !== "Təqdim edilib") throw new Error("Yalnız təqdim edilmiş tapşırıq təsdiqlənə bilər.");
    if (!(score >= 1 && score <= 10)) throw new Error("Qiymət 1 ilə 10 arasında olmalıdır.");
  } else if (input.status === "Geri qaytarılıb") {
    if (current.status !== "Təqdim edilib") throw new Error("Yalnız təqdim edilmiş tapşırıq geri qaytarıla bilər.");
    if (!input.evaluationNote?.trim()) throw new Error("Geri qaytarma səbəbini yazın.");
  }
  const status = input.status ?? current.status;
  const completedAt = status === "Təsdiqlənib" ? (current.completed_at || new Date().toISOString()) : current.completed_at;
  const employeeStatusChanged = input.userMode
    ? Number(current.employee_status_changed || 0) + 1
    : status === "Geri qaytarılıb" ? 1 : Number(current.employee_status_changed || 0);
  await db().prepare(`UPDATE tasks SET status = ?, evaluation = ?, evaluation_note = ?, completed_at = ?, employee_status_changed = ?,
    submission_attachment_key = ?, submission_attachment_name = ?, submission_attachment_size = ?, submission_attachment_type = ? WHERE id = ?`)
    .bind(
      status,
      input.evaluation ?? current.evaluation,
      input.evaluationNote ?? current.evaluation_note,
      completedAt,
      employeeStatusChanged,
      input.submissionAttachmentKey ?? current.submission_attachment_key,
      input.submissionAttachmentName ?? current.submission_attachment_name,
      input.submissionAttachmentSize ?? current.submission_attachment_size,
      input.submissionAttachmentType ?? current.submission_attachment_type,
      input.id,
    ).run();
  if (status === "Təsdiqlənib") {
    await db().prepare("UPDATE personal_work_checklist_items SET done = 1 WHERE delegated_task_id = ?").bind(input.id).run();
  }
}

export async function deleteTask(id: number) {
  const task = await db().prepare("SELECT id, status, attachment_key FROM tasks WHERE id = ?").bind(id).first<{ id: number; status: string; attachment_key: string | null }>();
  if (!task) throw new Error("Tapşırıq tapılmadı.");
  if (task.status !== "Yeni") throw new Error("Yalnız “Yeni” statuslu tapşırıq silinə bilər.");
  await db().prepare("UPDATE personal_work_checklist_items SET delegated_task_id = NULL, delegated_employee_id = NULL WHERE delegated_task_id = ?").bind(id).run();
  await db().prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  if (task.attachment_key && env.FILES) await env.FILES.delete(task.attachment_key);
}

export async function getChecklistItems(taskId: number) {
  await ensureSchema();
  return (await db().prepare("SELECT * FROM task_checklist_items WHERE task_id = ? ORDER BY id").bind(taskId).all()).results;
}

export async function createChecklistItem(input: { taskId: number; title: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İş addımının adını yazın.");
  await db().prepare("INSERT INTO task_checklist_items (task_id, title, done, created_at) VALUES (?, ?, 0, ?)")
    .bind(input.taskId, title, new Date().toISOString()).run();
  return getChecklistItems(input.taskId);
}

export async function toggleChecklistItem(input: { id: number; done: boolean }) {
  await ensureSchema();
  const item = await db().prepare("SELECT task_id FROM task_checklist_items WHERE id = ?").bind(input.id).first<{ task_id: number }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  await db().prepare("UPDATE task_checklist_items SET done = ? WHERE id = ?").bind(Number(input.done), input.id).run();
  return getChecklistItems(item.task_id);
}

export async function deleteChecklistItem(input: { id: number }) {
  await ensureSchema();
  const item = await db().prepare("SELECT task_id FROM task_checklist_items WHERE id = ?").bind(input.id).first<{ task_id: number }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  await db().prepare("DELETE FROM task_checklist_items WHERE id = ?").bind(input.id).run();
  return getChecklistItems(item.task_id);
}

export async function getPersonalWorks(userId: number | null) {
  await ensureSchema();
  const base = `SELECT personal_works.*, app_users.name AS owner_name, companies.name AS company_name
    FROM personal_works
    JOIN app_users ON app_users.id = personal_works.user_id
    LEFT JOIN companies ON companies.id = personal_works.company_id`;
  if (userId) {
    return (await db().prepare(`${base} WHERE personal_works.user_id = ? ORDER BY personal_works.created_at DESC, personal_works.id DESC`).bind(userId).all()).results;
  }
  return (await db().prepare(`${base} ORDER BY personal_works.created_at DESC, personal_works.id DESC`).all()).results;
}

export async function createPersonalWork(input: { userId: number; title: string; description?: string; companyId?: number; dueAt?: string; attachmentKey?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İşin adını yazın.");
  await db().prepare(`INSERT INTO personal_works (user_id, title, description, company_id, due_at, status, created_at, attachment_key, attachment_name, attachment_size, attachment_type)
    VALUES (?, ?, ?, ?, ?, 'Yeni', ?, ?, ?, ?, ?)`)
    .bind(input.userId, title, input.description?.trim() || null, input.companyId || null, input.dueAt || null, new Date().toISOString(), input.attachmentKey || null, input.attachmentName || null, input.attachmentSize || null, input.attachmentType || null).run();
}

export async function updatePersonalWorkStatus(input: { id: number; userId: number; status: string }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("İş tapılmadı.");
  if (Number(current.user_id) !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  const validTransition = (current.status === "Yeni" && input.status === "İcradadır") || (current.status === "İcradadır" && input.status === "Tamamlanıb");
  if (!validTransition) throw new Error("Status yalnız “Yeni” → “İcradadır” → “Tamamlanıb” ardıcıllığı ilə dəyişə bilər.");
  if (input.status === "Tamamlanıb") {
    const unfinished = await db().prepare("SELECT COUNT(*) AS count FROM personal_work_checklist_items WHERE personal_work_id = ? AND done = 0").bind(input.id).first<{ count: number }>();
    if (unfinished?.count) throw new Error(`İşi tamamlamaq üçün iş axınındakı bütün addımlarda ✓ olmalıdır (${unfinished.count} addım qalıb).`);
  }
  const completedAt = input.status === "Tamamlanıb" ? new Date().toISOString() : null;
  await db().prepare("UPDATE personal_works SET status = ?, completed_at = ? WHERE id = ?").bind(input.status, completedAt, input.id).run();
}

export async function deletePersonalWork(input: { id: number; userId: number }) {
  await ensureSchema();
  const current = await db().prepare("SELECT user_id, status FROM personal_works WHERE id = ?").bind(input.id).first<{ user_id: number; status: string }>();
  if (!current) throw new Error("İş tapılmadı.");
  if (current.user_id !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  if (current.status !== "Yeni") throw new Error("Yalnız “Yeni” statuslu iş silinə bilər.");
  await db().prepare("DELETE FROM personal_works WHERE id = ?").bind(input.id).run();
}

export async function getPersonalWorkChecklist(personalWorkId: number) {
  await ensureSchema();
  return (await db().prepare(`SELECT personal_work_checklist_items.*, delegated_employee.name AS delegated_employee_name, delegated_task.status AS delegated_task_status
    FROM personal_work_checklist_items
    LEFT JOIN employees AS delegated_employee ON delegated_employee.id = personal_work_checklist_items.delegated_employee_id
    LEFT JOIN tasks AS delegated_task ON delegated_task.id = personal_work_checklist_items.delegated_task_id
    WHERE personal_work_id = ? ORDER BY id`).bind(personalWorkId).all()).results;
}

export async function createPersonalWorkChecklistItem(input: { personalWorkId: number; title: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İş addımının adını yazın.");
  const work = await db().prepare("SELECT status FROM personal_works WHERE id = ?").bind(input.personalWorkId).first<{ status: string }>();
  if (!work) throw new Error("İş tapılmadı.");
  if (work.status === "Tamamlanıb") throw new Error("Tamamlanmış işə yeni addım əlavə etmək olmaz.");
  await db().prepare("INSERT INTO personal_work_checklist_items (personal_work_id, title, done, created_at) VALUES (?, ?, 0, ?)")
    .bind(input.personalWorkId, title, new Date().toISOString()).run();
  return getPersonalWorkChecklist(input.personalWorkId);
}

export async function togglePersonalWorkChecklistItem(input: { id: number; done: boolean }) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım işçiyə həvalə edilib, statusu tapşırığın təsdiqi ilə avtomatik yenilənəcək.");
  await db().prepare("UPDATE personal_work_checklist_items SET done = ? WHERE id = ?").bind(Number(input.done), input.id).run();
  return getPersonalWorkChecklist(item.personal_work_id);
}

export async function delegatePersonalWorkChecklistItem(input: { id: number; userId: number; employeeId: number; comment?: string }) {
  await ensureSchema();
  const item = await db().prepare("SELECT * FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım artıq həvalə edilib.");
  const work = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(item.personal_work_id).first<Record<string, unknown>>();
  if (!work) throw new Error("İş tapılmadı.");
  if (Number(work.user_id) !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  if (work.status === "Tamamlanıb") throw new Error("Tamamlanmış işdə addım işçiyə həvalə edilə bilməz.");
  if (!work.company_id) throw new Error("Həvalə etmək üçün əvvəlcə işin firmasını seçin.");
  if (!work.due_at) throw new Error("Həvalə etmək üçün əvvəlcə işin son tarixini təyin edin.");
  const allowed = await db().prepare("SELECT 1 FROM employee_companies WHERE employee_id = ? AND company_id = ?").bind(input.employeeId, work.company_id).first();
  if (!allowed) throw new Error("Bu işçi bu firma üzrə səlahiyyətli deyil.");
  // The task gets its own copy of the step's file so deleting either one never orphans the other.
  let attachment: { key: string; name: string | null; size: number | null; type: string | null } | null = null;
  if (item.attachment_key && env.FILES) {
    const source = await env.FILES.get(String(item.attachment_key));
    if (source) {
      const copyKey = `${crypto.randomUUID()}-${String(item.attachment_name || "fayl").replace(/[^\p{L}\p{N}._-]+/gu, "_")}`;
      await env.FILES.put(copyKey, await source.arrayBuffer(), { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata });
      attachment = { key: copyKey, name: (item.attachment_name as string | null) ?? null, size: (item.attachment_size as number | null) ?? null, type: (item.attachment_type as string | null) ?? null };
    }
  }
  const result = await db().prepare(`INSERT INTO tasks
    (employee_id, company_id, title, description, due_at, original_due_at, status, created_at, attachment_key, attachment_name, attachment_size, attachment_type) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?, ?, ?, ?, ?)`)
    .bind(input.employeeId, work.company_id, `${work.title} — ${item.title}`, input.comment?.trim() || null, work.due_at, work.due_at, new Date().toISOString(), attachment?.key ?? null, attachment?.name ?? null, attachment?.size ?? null, attachment?.type ?? null).run();
  const taskId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  await db().prepare("UPDATE personal_work_checklist_items SET delegated_task_id = ?, delegated_employee_id = ? WHERE id = ?").bind(taskId, input.employeeId, input.id).run();
  return getPersonalWorkChecklist(Number(item.personal_work_id));
}

export async function setPersonalWorkChecklistItemAttachment(input: { id: number; attachment: { key: string; name: string; size: number; type: string } | null }) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, attachment_key FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; attachment_key: string | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addımın faylı dəyişdirilə bilməz.");
  await db().prepare("UPDATE personal_work_checklist_items SET attachment_key = ?, attachment_name = ?, attachment_size = ?, attachment_type = ? WHERE id = ?")
    .bind(input.attachment?.key ?? null, input.attachment?.name ?? null, input.attachment?.size ?? null, input.attachment?.type ?? null, input.id).run();
  if (item.attachment_key && item.attachment_key !== input.attachment?.key && env.FILES) await env.FILES.delete(item.attachment_key);
  return getPersonalWorkChecklist(item.personal_work_id);
}

export async function deletePersonalWorkChecklistItem(input: { id: number }) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, attachment_key FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; attachment_key: string | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addım silinə bilməz.");
  await db().prepare("DELETE FROM personal_work_checklist_items WHERE id = ?").bind(input.id).run();
  if (item.attachment_key && env.FILES) await env.FILES.delete(item.attachment_key);
  return getPersonalWorkChecklist(item.personal_work_id);
}

export async function getDocumentTemplates() {
  await ensureSchema();
  return (await db().prepare("SELECT * FROM document_templates ORDER BY name").all()).results;
}

export async function createDocumentTemplate(input: { name: string; template1Key?: string; template1Name?: string; template1Size?: number; template1Type?: string; template2Key?: string; template2Name?: string; template2Size?: number; template2Type?: string; template3Key?: string; template3Name?: string; template3Size?: number; template3Type?: string }) {
  await ensureSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Sənədin adını yazın.");
  await db().prepare(`INSERT INTO document_templates
    (name, template1_key, template1_name, template1_size, template1_type, template2_key, template2_name, template2_size, template2_type, template3_key, template3_name, template3_size, template3_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, input.template1Key || null, input.template1Name || null, input.template1Size || null, input.template1Type || null, input.template2Key || null, input.template2Name || null, input.template2Size || null, input.template2Type || null, input.template3Key || null, input.template3Name || null, input.template3Size || null, input.template3Type || null, new Date().toISOString()).run();
}

export async function updateDocumentTemplate(input: { id: number; name?: string; template1Key?: string; template1Name?: string; template1Size?: number; template1Type?: string; template2Key?: string; template2Name?: string; template2Size?: number; template2Type?: string; template3Key?: string; template3Name?: string; template3Size?: number; template3Type?: string }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM document_templates WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Sənəd tapılmadı.");
  await db().prepare(`UPDATE document_templates SET name = ?, template1_key = ?, template1_name = ?, template1_size = ?, template1_type = ?, template2_key = ?, template2_name = ?, template2_size = ?, template2_type = ?, template3_key = ?, template3_name = ?, template3_size = ?, template3_type = ? WHERE id = ?`)
    .bind(
      input.name?.trim() || current.name,
      input.template1Key ?? current.template1_key,
      input.template1Name ?? current.template1_name,
      input.template1Size ?? current.template1_size,
      input.template1Type ?? current.template1_type,
      input.template2Key ?? current.template2_key,
      input.template2Name ?? current.template2_name,
      input.template2Size ?? current.template2_size,
      input.template2Type ?? current.template2_type,
      input.template3Key ?? current.template3_key,
      input.template3Name ?? current.template3_name,
      input.template3Size ?? current.template3_size,
      input.template3Type ?? current.template3_type,
      input.id,
    ).run();
}

export async function deleteDocumentTemplate(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM document_templates WHERE id = ?").bind(id).run();
}

export async function getOutgoingDocuments() {
  await ensureSchema();
  return (await db().prepare("SELECT * FROM outgoing_documents ORDER BY id DESC").all()).results;
}

export async function createOutgoingDocument(input: { outgoingNo: string; outgoingDate?: string; incomingNo?: string; incomingDate?: string; sendingDepartment?: string; documentType?: string; sendingMethod?: string; deliveredBy?: string; copies?: string; documentNumber?: string; documentDate?: string; voen?: string; organizationName?: string; phone?: string; note?: string; attachmentKey?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) {
  await ensureSchema();
  const outgoingNo = input.outgoingNo?.trim();
  if (!outgoingNo) throw new Error("Çıxış nömrəsini yazın.");
  await db().prepare(`INSERT INTO outgoing_documents
    (outgoing_no, outgoing_date, incoming_no, incoming_date, sending_department, document_type, sending_method, delivered_by, copies, document_number, document_date, voen, organization_name, phone, note, attachment_key, attachment_name, attachment_size, attachment_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(outgoingNo, input.outgoingDate || null, input.incomingNo || null, input.incomingDate || null, input.sendingDepartment || null, input.documentType || null, input.sendingMethod || null, input.deliveredBy || null, input.copies || null, input.documentNumber || null, input.documentDate || null, input.voen || null, input.organizationName || null, input.phone || null, input.note || null, input.attachmentKey || null, input.attachmentName || null, input.attachmentSize || null, input.attachmentType || null, new Date().toISOString()).run();
}

export async function updateOutgoingDocument(input: { id: number; outgoingNo?: string; outgoingDate?: string; incomingNo?: string; incomingDate?: string; sendingDepartment?: string; documentType?: string; sendingMethod?: string; deliveredBy?: string; copies?: string; documentNumber?: string; documentDate?: string; voen?: string; organizationName?: string; phone?: string; note?: string; attachmentKey?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM outgoing_documents WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Sənəd tapılmadı.");
  await db().prepare(`UPDATE outgoing_documents SET outgoing_no = ?, outgoing_date = ?, incoming_no = ?, incoming_date = ?, sending_department = ?, document_type = ?, sending_method = ?, delivered_by = ?, copies = ?, document_number = ?, document_date = ?, voen = ?, organization_name = ?, phone = ?, note = ?, attachment_key = ?, attachment_name = ?, attachment_size = ?, attachment_type = ? WHERE id = ?`)
    .bind(
      input.outgoingNo?.trim() || current.outgoing_no,
      input.outgoingDate ?? current.outgoing_date,
      input.incomingNo ?? current.incoming_no,
      input.incomingDate ?? current.incoming_date,
      input.sendingDepartment ?? current.sending_department,
      input.documentType ?? current.document_type,
      input.sendingMethod ?? current.sending_method,
      input.deliveredBy ?? current.delivered_by,
      input.copies ?? current.copies,
      input.documentNumber ?? current.document_number,
      input.documentDate ?? current.document_date,
      input.voen ?? current.voen,
      input.organizationName ?? current.organization_name,
      input.phone ?? current.phone,
      input.note ?? current.note,
      input.attachmentKey ?? current.attachment_key,
      input.attachmentName ?? current.attachment_name,
      input.attachmentSize ?? current.attachment_size,
      input.attachmentType ?? current.attachment_type,
      input.id,
    ).run();
}

export async function deleteOutgoingDocument(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM outgoing_documents WHERE id = ?").bind(id).run();
}

export async function getCustomers() {
  await ensureSchema();
  return (await db().prepare("SELECT * FROM customers ORDER BY name").all()).results;
}

export async function createCustomer(input: { entityType?: string; voen?: string; name: string; legalAddress?: string; legalAddress2?: string; manager?: string }) {
  await ensureSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Müştərinin adını yazın.");
  const entityType = input.entityType?.trim();
  if (!entityType) throw new Error("Statusu seçin.");
  const voen = input.voen?.trim() || null;
  if (!voen) throw new Error("VÖEN/FİN daxil edin.");
  const legalAddress = input.legalAddress?.trim();
  if (!legalAddress) throw new Error("Hüquqi ünvanı yazın.");
  const manager = input.manager?.trim();
  if (!manager) throw new Error("Rəhbəri yazın.");
  const duplicate = await db().prepare("SELECT id, name FROM customers WHERE voen = ?").bind(voen).first<{ id: number; name: string }>();
  if (duplicate) throw new Error(`Bu VÖEN/FİN artıq "${duplicate.name}" müştərisində qeydə alınıb. Təkrar müştəri kartı yaradıla bilməz.`);
  await db().prepare(`INSERT INTO customers
    (entity_type, voen, name, legal_address, legal_address2, manager, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(entityType, voen, name, legalAddress, input.legalAddress2 || null, manager, new Date().toISOString()).run();
}

export async function updateCustomer(input: { id: number; entityType?: string; voen?: string; name?: string; legalAddress?: string; legalAddress2?: string; manager?: string }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM customers WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Müştəri tapılmadı.");
  const name = input.name?.trim() || (current.name as string);
  if (!name) throw new Error("Müştərinin adını yazın.");
  const entityType = input.entityType === undefined ? (current.entity_type as string | null) : input.entityType.trim();
  if (!entityType) throw new Error("Statusu seçin.");
  const voen = input.voen === undefined ? (current.voen as string | null) : (input.voen.trim() || null);
  if (!voen) throw new Error("VÖEN/FİN daxil edin.");
  const legalAddress = input.legalAddress === undefined ? (current.legal_address as string | null) : input.legalAddress.trim();
  if (!legalAddress) throw new Error("Hüquqi ünvanı yazın.");
  const manager = input.manager === undefined ? (current.manager as string | null) : input.manager.trim();
  if (!manager) throw new Error("Rəhbəri yazın.");
  const duplicate = await db().prepare("SELECT id, name FROM customers WHERE voen = ? AND id != ?").bind(voen, input.id).first<{ id: number; name: string }>();
  if (duplicate) throw new Error(`Bu VÖEN/FİN artıq "${duplicate.name}" müştərisində qeydə alınıb. Təkrar müştəri kartı yaradıla bilməz.`);
  await db().prepare("UPDATE customers SET entity_type = ?, voen = ?, name = ?, legal_address = ?, legal_address2 = ?, manager = ? WHERE id = ?")
    .bind(
      entityType,
      voen,
      name,
      legalAddress,
      input.legalAddress2 ?? current.legal_address2,
      manager,
      input.id,
    ).run();
}

export async function deleteCustomer(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
}

export async function createRecurring(input: { employeeId: number; title: string; description?: string; dueDay?: number; frequency?:string; weekday?:number; dueTime?:string }) {
  await db().prepare(`INSERT INTO recurring_tasks
    (employee_id, title, description, due_day, frequency, weekday, due_time, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(input.employeeId, input.title, input.description || null, input.dueDay || 25, input.frequency || "monthly", input.weekday || null, input.dueTime || "14:00", new Date().toISOString()).run();
  await ensureRecurringTasks();
}

export async function listViolations() {
  await ensureSchema();
  return (await db().prepare(`SELECT employee_violations.*, employees.name AS employee_name, companies.name AS company_name
    FROM employee_violations
    JOIN employees ON employees.id = employee_violations.employee_id
    LEFT JOIN companies ON companies.id = employee_violations.company_id
    ORDER BY employee_violations.created_at DESC`).all()).results;
}

export async function listViolationsForEmployee(employeeId: number) {
  await ensureSchema();
  return (await db().prepare(`SELECT employee_violations.*, employees.name AS employee_name, companies.name AS company_name
    FROM employee_violations
    JOIN employees ON employees.id = employee_violations.employee_id
    LEFT JOIN companies ON companies.id = employee_violations.company_id
    WHERE employee_violations.employee_id = ?
    ORDER BY employee_violations.created_at DESC`).bind(employeeId).all()).results;
}

export async function createViolation(input: { employeeId: number; companyId?: number; title: string; note?: string; createdByName?: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("Noqsanın başlığını yazın.");
  if (!input.employeeId) throw new Error("Personal seçin.");
  await db().prepare(`INSERT INTO employee_violations (employee_id, company_id, title, note, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(input.employeeId, input.companyId || null, title, input.note?.trim() || null, input.createdByName || null, new Date().toISOString()).run();
}

export async function deleteViolation(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM employee_violations WHERE id = ?").bind(id).run();
}

export async function updateRecurring(input: { id: number; active?: boolean }) {
  await db().prepare("UPDATE recurring_tasks SET active = ? WHERE id = ?").bind(Number(input.active), input.id).run();
}
