import { env, folderStore } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import { DEFAULT_FIXED_START, FIXED_FREQUENCIES, hasFixedDue, isLongPeriod, periodCounts, periodWindow } from "@/lib/fixed-periods";
import { AWAITING_EVALUATION, companyDepartments, createRequest, departmentHeadIds, ensureRequestSchema, requestForTask, syncRequestFromTask } from "@/db/requests";
import { firmAccess, parseHiddenSections, rightsForType, typeKey, type FirmAccess } from "@/lib/permissions";
import { companyPermissionsFromStored, parseCompanyPermissions } from "@/lib/permission-model";
import { formatPhone } from "@/lib/phone";
import { copyFiles, fileNames, filesOf, filesOfMany, parseFiles, removeFiles, setFiles, withFiles, type FileRef } from "@/db/attachments";

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
  // Versiya 3.12: when the worker last submitted the task — "Vaxtında icra" on Ana səhifə goes by it, not by the approval.
  if (!columns.results.some((column) => column.name === "submitted_at")) await db().prepare("ALTER TABLE tasks ADD COLUMN submitted_at TEXT").run();
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
  const taskChecklistItemColumns = await db().prepare("PRAGMA table_info(task_checklist_items)").all<{ name: string }>();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN attachment_key TEXT").run();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN attachment_name TEXT").run();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN attachment_size INTEGER").run();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN attachment_type TEXT").run();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "delegated_task_id")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN delegated_task_id INTEGER REFERENCES tasks(id)").run();
  if (!taskChecklistItemColumns.results.some((column) => column.name === "delegated_employee_id")) await db().prepare("ALTER TABLE task_checklist_items ADD COLUMN delegated_employee_id INTEGER REFERENCES employees(id)").run();
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
  if (!documentColumns.results.some((column) => column.name === "draft_folder_path")) await db().prepare("ALTER TABLE document_templates ADD COLUMN draft_folder_path TEXT").run();
  if (!documentColumns.results.some((column) => column.name === "final_folder_path")) await db().prepare("ALTER TABLE document_templates ADD COLUMN final_folder_path TEXT").run();
  // Which register a template serves: outgoing documents (NULL, the original kind) or HR "Digər əmrlər", whose text is read from its Word file.
  if (!documentColumns.results.some((column: { name: string }) => column.name === "template_group")) await db().prepare("ALTER TABLE document_templates ADD COLUMN template_group TEXT").run();
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
  const customerColumns = await db().prepare("PRAGMA table_info(customers)").all<{ name: string }>();
  if (!customerColumns.results.some((column) => column.name === "country")) await db().prepare("ALTER TABLE customers ADD COLUMN country TEXT").run();
  if (!customerColumns.results.some((column: { name: string }) => column.name === "phone")) await db().prepare("ALTER TABLE customers ADD COLUMN phone TEXT").run();
  const outgoingColumns = await db().prepare("PRAGMA table_info(outgoing_documents)").all<{ name: string }>();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_key")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_key TEXT").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_name")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_name TEXT").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_size")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_size INTEGER").run();
  if (!outgoingColumns.results.some((column) => column.name === "attachment_type")) await db().prepare("ALTER TABLE outgoing_documents ADD COLUMN attachment_type TEXT").run();
  // Per-firm documents: the written (draft) and client-signed (final) files, each renamed by the template's rule and stored either
  // in a server folder (*_path) or, where no folder can be written, in the FILES bucket (*_key). file_base_name keeps both stages on one name.
  if (!documentColumns.results.some((column) => column.name === "file_name_pattern")) await db().prepare("ALTER TABLE document_templates ADD COLUMN file_name_pattern TEXT").run();
  // Daxil olan sənədlər of this type: the folder their scan goes to and how it is named.
  if (!documentColumns.results.some((column) => column.name === "incoming_folder_path")) await db().prepare("ALTER TABLE document_templates ADD COLUMN incoming_folder_path TEXT").run();
  if (!documentColumns.results.some((column) => column.name === "incoming_name_pattern")) await db().prepare("ALTER TABLE document_templates ADD COLUMN incoming_name_pattern TEXT").run();
  // "İmzalı nüsxə geri qaytarılır": whether the other side must send one signed copy back (contract, act) or not (a letter).
  // Existing templates start as "Bəli", so nothing that is awaited today silently stops being awaited.
  if (!documentColumns.results.some((column) => column.name === "signed_copy_returns")) await db().prepare("ALTER TABLE document_templates ADD COLUMN signed_copy_returns INTEGER NOT NULL DEFAULT 1").run();
  // Versiya 2.75: how many (calendar) days the other side has to send the signed copy back.
  if (!documentColumns.results.some((column) => column.name === "signed_copy_days")) await db().prepare("ALTER TABLE document_templates ADD COLUMN signed_copy_days INTEGER").run();
  // Versiya 2.76: every template belongs to one firm (company_id) and one group — 'outgoing' (Çıxan sənəd), 'incoming'
  // (Daxil olan sənəd) or 'other_order' (Kadrlar → Digər əmrlər). The earlier shared templates are copied to every active firm once.
  if (!documentColumns.results.some((column) => column.name === "company_id")) await db().prepare("ALTER TABLE document_templates ADD COLUMN company_id INTEGER REFERENCES companies(id)").run();
  await splitSharedTemplates();
  // Versiya 2.77: "Aidiyyatı şöbələr" of a document type (JSON list of the firm's departments, the first is the main one); a document
  // of that type gets them on registration instead of the registrar picking. Documents also keep "Məlumatlandırılan şöbə(lər)"
  // (informed_departments): their heads only see the document.
  if (!documentColumns.results.some((column) => column.name === "departments")) await db().prepare("ALTER TABLE document_templates ADD COLUMN departments TEXT").run();
  // On a document, signed_copy_returns overrides its template for that one document (NULL = follow the template).
  // Versiya 2.75: return_due_date — by when the signed copy must be back (sending date + the template's days, editable);
  // responsible_employee_id — the person who takes the document out and answers for its return (delivered_by keeps the name).
  // related_departments: JSON list of the departments the document concerns; the first is its main one (sending_department, {Şöbə}).
  // approval_flow 1: registered from Versiya 2.61 on, so it goes through the two-level approval (older documents do not).
  for (const column of ["approval_flow INTEGER", "related_departments TEXT", "company_id INTEGER REFERENCES companies(id)", "file_base_name TEXT", "draft_path TEXT", "draft_key TEXT", "draft_name TEXT", "draft_size INTEGER", "draft_type TEXT", "final_path TEXT", "final_key TEXT", "final_name TEXT", "final_size INTEGER", "final_type TEXT", "signed_copy_returns INTEGER", "return_due_date TEXT", "responsible_employee_id INTEGER", "informed_departments TEXT", "created_by INTEGER"]) {
    if (!outgoingColumns.results.some((existing) => existing.name === column.split(" ")[0])) await db().prepare(`ALTER TABLE outgoing_documents ADD COLUMN ${column}`).run();
  }
  await db().prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT)").run();
  // Daxil olan sənədlər: registered incoming documents (their scan is stored like outgoing files) and, once sent for execution, the task it became.
  await db().prepare(`CREATE TABLE IF NOT EXISTS incoming_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    incoming_no TEXT NOT NULL,
    incoming_date TEXT,
    sender_voen TEXT,
    sender_name TEXT,
    sender_doc_no TEXT,
    sender_doc_date TEXT,
    document_type TEXT,
    receive_method TEXT,
    summary TEXT,
    pages TEXT,
    copies TEXT,
    note TEXT,
    file_base_name TEXT,
    file_path TEXT,
    file_key TEXT,
    file_name TEXT,
    file_size INTEGER,
    file_type TEXT,
    info_only INTEGER NOT NULL DEFAULT 0,
    resolution TEXT,
    assignee_employee_id INTEGER REFERENCES employees(id),
    due_date TEXT,
    task_id INTEGER,
    assigned_by_name TEXT,
    assigned_at TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const incomingColumns = await db().prepare("PRAGMA table_info(incoming_documents)").all<{ name: string }>();
  // related_departments: JSON list of the departments the document concerns; flow 2: registered under the 2.59 rules (director first).
  for (const column of ["director_pending INTEGER NOT NULL DEFAULT 0", "sent_to_director_by TEXT", "sent_to_director_at TEXT", "related_departments TEXT", "flow INTEGER", "director_seen_at TEXT", "director_seen_by TEXT", "informed_departments TEXT"]) {
    if (!incomingColumns.results.some((existing) => existing.name === column.split(" ")[0])) await db().prepare(`ALTER TABLE incoming_documents ADD COLUMN ${column}`).run();
  }
  // Approvals of incoming and outgoing documents (Versiya 2.61): one row per step, kept as history.
  await db().prepare(`CREATE TABLE IF NOT EXISTS document_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    doc_kind TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    level TEXT NOT NULL,
    department TEXT,
    action TEXT NOT NULL,
    note TEXT,
    user_id INTEGER,
    user_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  // One row per department a document was sent to: the department head who got it and the task it became.
  await db().prepare(`CREATE TABLE IF NOT EXISTS incoming_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    incoming_id INTEGER NOT NULL REFERENCES incoming_documents(id) ON DELETE CASCADE,
    department TEXT NOT NULL,
    head_employee_id INTEGER REFERENCES employees(id),
    task_id INTEGER,
    created_at TEXT NOT NULL
  )`).run();
  // Documents sent to a single employee before routing went by department keep that task as their one assignment.
  await db().prepare(`INSERT INTO incoming_assignments (incoming_id, department, head_employee_id, task_id, created_at)
    SELECT i.id, '—', i.assignee_employee_id, i.task_id, COALESCE(i.assigned_at, i.created_at) FROM incoming_documents i
    WHERE i.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM incoming_assignments a WHERE a.incoming_id = i.id)`).run();
  await db().prepare("UPDATE incoming_documents SET task_id = NULL, assignee_employee_id = NULL WHERE task_id IS NOT NULL").run();
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
  // Versiya 3.05: a step has its own description (the first step gets the work's).
  if (!checklistItemColumns.results.some((column) => column.name === "description")) await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN description TEXT").run();
  // Versiya 3.09: the step made together with the work cannot be deleted on its own. When the column is added, the steps already
  // made that way (since 3.05) are marked: a work's first step, created within seconds of the work, in a work whose history says so.
  if (!checklistItemColumns.results.some((column) => column.name === "auto_created")) {
    await db().prepare("ALTER TABLE personal_work_checklist_items ADD COLUMN auto_created INTEGER DEFAULT 0").run();
    const events = await db().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'personal_work_events'").first();
    if (events) await db().prepare(`UPDATE personal_work_checklist_items SET auto_created = 1 WHERE id IN (
      SELECT MIN(i.id) FROM personal_work_checklist_items i JOIN personal_works w ON w.id = i.personal_work_id
      WHERE EXISTS (SELECT 1 FROM personal_work_events e WHERE e.personal_work_id = w.id AND e.action = 'Addım əlavə edildi' AND e.detail LIKE '%(iş yaradılanda avtomatik)%')
      GROUP BY i.personal_work_id
      HAVING ABS(julianday(MIN(i.created_at)) - julianday(MIN(w.created_at))) * 86400 < 10)`).run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS personal_work_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    personal_work_id INTEGER NOT NULL REFERENCES personal_works(id) ON DELETE CASCADE,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const employeeColumns = await db().prepare("PRAGMA table_info(employees)").all<{ name: string }>();
  if (!employeeColumns.results.some((column) => column.name === "main_company_id")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN main_company_id INTEGER REFERENCES companies(id)").run();
  }
  if (!employeeColumns.results.some((column) => column.name === "avatar_key")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN avatar_key TEXT").run();
  }
  if (!employeeColumns.results.some((column) => column.name === "manager_employee_id")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN manager_employee_id INTEGER REFERENCES employees(id)").run();
  }
  // Sections hidden from this employee (JSON array of keys, see lib/permissions.ts); NULL = sees everything.
  if (!employeeColumns.results.some((column) => column.name === "hidden_sections")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN hidden_sections TEXT").run();
  }
  // Versiya 2.99: the firm sections' rights per firm (lib/permission-model.ts). On adding the column, each user's old one-for-all
  // rights are written out for every firm they work in, so nobody's rights change; a firm added later starts fully closed.
  if (!employeeColumns.results.some((column) => column.name === "company_permissions")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN company_permissions TEXT").run();
    const linked = await db().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'employee_companies'").first();
    const rows = !linked ? [] : (await db().prepare("SELECT id, hidden_sections, (SELECT group_concat(company_id) FROM employee_companies WHERE employee_id = employees.id) AS company_ids FROM employees").all<{ id: number; hidden_sections: string | null; company_ids: string | null }>()).results;
    for (const row of rows) {
      const companyIds = String(row.company_ids || "").split(",").map(Number).filter(Boolean);
      await db().prepare("UPDATE employees SET company_permissions = ? WHERE id = ?").bind(JSON.stringify(companyPermissionsFromStored(parseHiddenSections(row.hidden_sections), companyIds)), row.id).run();
    }
  }
  // Versiya 3.00: Şəxsi işlərim, Sabit işlər, Müştərilər and Çat moved from "Ümumi" into every firm — once, each user's old choice
  // there is written into all of their firms.
  if (!(await db().prepare("SELECT 1 AS ok FROM app_settings WHERE key = 'permissions_general_per_firm'").first())) {
    const linked = await db().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'employee_companies'").first();
    const rows = !linked ? [] : (await db().prepare("SELECT id, hidden_sections, company_permissions, (SELECT group_concat(company_id) FROM employee_companies WHERE employee_id = employees.id) AS company_ids FROM employees").all<{ id: number; hidden_sections: string | null; company_permissions: string | null; company_ids: string | null }>()).results;
    for (const row of rows) {
      const companyIds = String(row.company_ids || "").split(",").map(Number).filter(Boolean);
      const legacy = companyPermissionsFromStored(parseHiddenSections(row.hidden_sections), companyIds);
      const current = parseCompanyPermissions(row.company_permissions);
      for (const id of companyIds.map(String)) {
        const firm = { ...(current[id] || {}) };
        for (const section of ["tasks.mine", "tasks.fixed", "dashboard.customers", "chat"] as const) {
          const entry = legacy[id]?.[section];
          if (entry) firm[section] = entry;
        }
        current[id] = firm;
      }
      await db().prepare("UPDATE employees SET company_permissions = ? WHERE id = ?").bind(JSON.stringify(current), row.id).run();
    }
    await db().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('permissions_general_per_firm', ?)").bind(new Date().toISOString()).run();
  }
  if (!employeeColumns.results.some((column) => column.name === "authority_type")) {
    await db().prepare("ALTER TABLE employees ADD COLUMN authority_type TEXT DEFAULT 'İşçi' NOT NULL").run();
  }
  const companyColumns = await db().prepare("PRAGMA table_info(companies)").all<{ name: string }>();
  if (!companyColumns.results.some((column) => column.name === "voen")) {
    await db().prepare("ALTER TABLE companies ADD COLUMN voen TEXT").run();
  }
  if (!companyColumns.results.some((column) => column.name === "manager")) {
    await db().prepare("ALTER TABLE companies ADD COLUMN manager TEXT").run();
  }
  await db().prepare(`CREATE TABLE IF NOT EXISTS company_structure_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    department TEXT NOT NULL,
    title TEXT NOT NULL,
    reports_to TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`).run();
  // One-time seed: "Arsenal Construction and Engineering"'s org structure, supplied by the admin (Struktur-2V.xlsx). Runs once — skipped the moment that company already has any structure rows.
  const arsenal = await db().prepare("SELECT id FROM companies WHERE lower(trim(name)) = lower(trim(?))").bind("Arsenal Construction and Engineering").first<{ id: number }>();
  if (arsenal) {
    const existing = await db().prepare("SELECT COUNT(*) AS count FROM company_structure_positions WHERE company_id = ?").bind(arsenal.id).first<{ count: number }>();
    if (!existing?.count) {
      const seedRows: Array<[string, string, string | null]> = [
        ["Rəhbərlik", "Baş direktor", null],
        ["Rəhbərlik", "İcraçı direktor", "Baş direktor"],
        ["Maliyyə və təsərrüfat şöbəsi", "Maliyyə və təsərrüfat şöbəsinin müdiri", "Baş direktor/İcraçı direktor"],
        ["Maliyyə və təsərrüfat şöbəsi", "Aparıcı mühasib", "Maliyyə və təsərrüfat şöbəsinin müdiri"],
        ["Maliyyə və təsərrüfat şöbəsi", "Mühasib", "Maliyyə və təsərrüfat şöbəsinin müdiri"],
        ["Maliyyə və təsərrüfat şöbəsi", "Baş anbardar", "Maliyyə və təsərrüfat şöbəsinin müdiri"],
        ["Maliyyə və təsərrüfat şöbəsi", "Xadimə", "Maliyyə və təsərrüfat şöbəsinin müdiri"],
        ["Layihələndirmə və qiymətləndirmə şöbəsi", "Layihələndirmə və qiymətləndirmə şöbəsi müdiri", "Baş direktor/İcraçı direktor"],
        ["Layihələndirmə və qiymətləndirmə şöbəsi", "Layihələndirmə və qiymətləndirmə şöbəsinin aparıcı mütəxəssisi", "Layihələndirmə və qiymətləndirmə şöbəsi müdiri"],
        ["Layihələndirmə və qiymətləndirmə şöbəsi", "Xarici əlaqələr şöbəsinin aparıcı mütəxəssisi", "Layihələndirmə və qiymətləndirmə şöbəsi müdiri"],
        ["Hüquq və insan resursları şöbəsi", "Hüquq və insan resursları şöbəsi müdiri", "Baş direktor/İcraçı direktor"],
        ["Hüquq və insan resursları şöbəsi", "Hüquqsunas", "Hüquq və insan resursları şöbəsi müdiri"],
        ["Satış şöbəsi", "Satış şöbəsi müdiri", "Baş direktor/İcraçı direktor"],
        ["Satış şöbəsi", "Satış üzrə menecer", "Satış şöbəsi müdiri"],
        ["Təchizat və logistika şöbəsi", "Təchizat və logistika şöbəsi müdiri", "Baş direktor/İcraçı direktor"],
        ["Təchizat və logistika şöbəsi", "Təchizat və logistika şöbəsinin aparıcı mütəxəssisi", "Təchizat və logistika şöbəsi müdiri"],
        ["Ümumi şöbə", "Ümumi şöbənin müdiri", "Baş direktor/İcraçı direktor"],
        ["Ümumi şöbə", "Ümumi şöbə üzrə aparıcı mütəxəssis", "Ümumi şöbənin müdiri"],
        ["Ümumi şöbə", "Ümumi şöbə üzrə mütəxəssis", "Ümumi şöbənin müdiri"],
        ["Texniki servis şöbəsi", "Texniki servis şöbəsi müdiri", "Baş direktor/İcraçı direktor"],
        ["Texniki şöbə", "Texniki şöbə müdiri", "Rəhbərlik"],
      ];
      const now = new Date().toISOString();
      let order = 0;
      for (const [department, title, reportsTo] of seedRows) {
        order += 1;
        await db().prepare("INSERT INTO company_structure_positions (company_id, department, title, reports_to, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(arsenal.id, department, title, reportsTo, order, now).run();
      }
    }
  }
  // One-time copy (requested by the admin): Arsenal's current structure is duplicated as-is into the companies below. Companies that already have structure rows are left untouched; the flag keeps it from re-running.
  await db().prepare("CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL)").run();
  const copyFlag = "structure-copy-from-arsenal-v1";
  if (!(await db().prepare("SELECT 1 FROM app_flags WHERE key = ?").bind(copyFlag).first())) {
    const normalize = (name: string) => name.trim().replace(/\s+mmc$/i, "").toLocaleLowerCase("az");
    const allCompanies = (await db().prepare("SELECT id, name FROM companies").all<{ id: number; name: string }>()).results;
    const source = allCompanies.find((company) => normalize(company.name) === normalize("Arsenal Construction and Engineering"));
    const sourceRows = source ? (await db().prepare("SELECT department, title, reports_to, sort_order FROM company_structure_positions WHERE company_id = ? ORDER BY sort_order, id").bind(source.id).all<{ department: string; title: string; reports_to: string | null; sort_order: number }>()).results : [];
    if (sourceRows.length) {
      const targetNames = ["Grand Fortune MMC", "Güvən Construction and Engineering", "Güvən Mühəndislik MMC", "Monotech Az MMC", "Safe Net MMC", "Zirə Sera MMC"].map(normalize);
      const now = new Date().toISOString();
      for (const target of allCompanies.filter((company) => targetNames.includes(normalize(company.name)))) {
        const existing = await db().prepare("SELECT COUNT(*) AS count FROM company_structure_positions WHERE company_id = ?").bind(target.id).first<{ count: number }>();
        if (existing?.count) continue;
        for (const row of sourceRows) {
          await db().prepare("INSERT INTO company_structure_positions (company_id, department, title, reports_to, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(target.id, row.department, row.title, row.reports_to, row.sort_order, now).run();
        }
      }
      await db().prepare("INSERT OR IGNORE INTO app_flags (key, created_at) VALUES (?, ?)").bind(copyFlag, now).run();
    }
  }
  // One-time (requested by the admin): outgoing documents registered before documents became per-firm belong to Arsenal.
  const outgoingFirmFlag = "outgoing-documents-to-arsenal-v1";
  if (!(await db().prepare("SELECT 1 FROM app_flags WHERE key = ?").bind(outgoingFirmFlag).first())) {
    const normalize = (name: string) => name.trim().replace(/\s+mmc$/i, "").toLocaleLowerCase("az");
    const allCompanies = (await db().prepare("SELECT id, name FROM companies").all<{ id: number; name: string }>()).results;
    const arsenal = allCompanies.find((company) => normalize(company.name) === normalize("Arsenal Construction and Engineering"));
    if (arsenal) {
      await db().prepare("UPDATE outgoing_documents SET company_id = ? WHERE company_id IS NULL").bind(arsenal.id).run();
      await db().prepare("INSERT OR IGNORE INTO app_flags (key, created_at) VALUES (?, ?)").bind(outgoingFirmFlag, new Date().toISOString()).run();
    }
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
  // Per-work deadline: monthly → day of the following month; weekly → weekday 1–7. NULL = default (10th of next month / Friday).
  if (!workDefinitionColumns.results.some((column) => column.name === "due_day")) {
    await db().prepare("ALTER TABLE work_definitions ADD COLUMN due_day INTEGER").run();
  }
  // Versiya 2.93: quarterly / half-yearly / yearly works are due on day due_day of month due_month after the period (NULL = default).
  if (!workDefinitionColumns.results.some((column) => column.name === "due_month")) {
    await db().prepare("ALTER TABLE work_definitions ADD COLUMN due_month INTEGER").run();
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
  const employeeCompanyColumns = await db().prepare("PRAGMA table_info(employee_companies)").all<{ name: string }>();
  if (!employeeCompanyColumns.results.some((column) => column.name === "position_id")) {
    await db().prepare("ALTER TABLE employee_companies ADD COLUMN position_id INTEGER REFERENCES company_structure_positions(id) ON DELETE SET NULL").run();
  }
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
  // The task list links each task back to the request it was created from, so that table must exist first.
  await ensureRequestSchema();
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

// For each task, walks the delegation chain backwards (task_checklist_items → personal_work_checklist_items)
// and returns the full "who gave it" chain, root first — e.g. ["Direktor", "Şöbə müdiri"] for a twice-delegated task.
async function attachAssignerChains(taskRows: Array<Record<string, unknown>>) {
  const fromTaskChecklist = (await db().prepare(`SELECT tci.delegated_task_id AS child_id, tci.task_id AS parent_task_id, e.name AS assigner_name
    FROM task_checklist_items tci
    JOIN tasks t ON t.id = tci.task_id
    JOIN employees e ON e.id = t.employee_id
    WHERE tci.delegated_task_id IS NOT NULL`).all<{ child_id: number; parent_task_id: number; assigner_name: string }>()).results;
  const fromPersonalWork = (await db().prepare(`SELECT pwci.delegated_task_id AS child_id, u.name AS assigner_name
    FROM personal_work_checklist_items pwci
    JOIN personal_works pw ON pw.id = pwci.personal_work_id
    JOIN app_users u ON u.id = pw.user_id
    WHERE pwci.delegated_task_id IS NOT NULL`).all<{ child_id: number; assigner_name: string }>()).results;
  const chainLink = new Map<number, { name: string; parent: number | null }>();
  for (const row of fromTaskChecklist) chainLink.set(row.child_id, { name: row.assigner_name, parent: row.parent_task_id });
  for (const row of fromPersonalWork) if (!chainLink.has(row.child_id)) chainLink.set(row.child_id, { name: row.assigner_name, parent: null });
  const resolve = (taskId: number) => {
    const names: string[] = [];
    const seen = new Set<number>();
    let cursor: number | null = taskId;
    while (cursor !== null && !seen.has(cursor) && names.length < 30) {
      seen.add(cursor);
      const link = chainLink.get(cursor);
      if (!link) break;
      names.unshift(link.name);
      cursor = link.parent;
    }
    return names.join(", ") || null;
  };
  // A task created from a request was given by the department head who accepted it and picked the assignee.
  return taskRows.map((row) => ({ ...row, assigned_by: resolve(Number(row.id)) || (row.request_accepted_by as string | null) || (row.incoming_assigned_by as string | null) || null }));
}

export async function getAllData() {
  await ensureSchema();
  await ensureRecurringTasks();
  const [employees, companies, recurring, workItems, workAssignments, workCompletions, tasks, dateRequests] = await Promise.all([
    db().prepare(`SELECT employees.*,
      (SELECT group_concat(company_id) FROM employee_companies WHERE employee_id = employees.id) AS company_ids,
      (SELECT json_group_array(json_object('company_id', ec.company_id, 'position_id', p.id, 'position_title', p.title))
        FROM employee_companies ec LEFT JOIN company_structure_positions p ON p.id = ec.position_id AND p.company_id = ec.company_id
        WHERE ec.employee_id = employees.id) AS company_positions
      FROM employees ORDER BY active DESC, name`).all(),
    db().prepare("SELECT * FROM companies ORDER BY active DESC, name").all(),
    db().prepare(`SELECT recurring_tasks.*, employees.name AS employee_name
      FROM recurring_tasks JOIN employees ON employees.id = recurring_tasks.employee_id
      ORDER BY recurring_tasks.active DESC, recurring_tasks.id DESC`).all(),
    db().prepare(`SELECT work_definitions.*,
      (SELECT group_concat(company_id) FROM work_definition_companies WHERE work_definition_id = work_definitions.id) AS company_ids
      FROM work_definitions ORDER BY id DESC`).all(),
    db().prepare(`SELECT a.*, d.title, d.description, d.frequency, d.due_day, d.due_month, e.name AS employee_name, c.name AS company_name
      FROM work_assignments a
      JOIN work_definitions d ON d.id = a.work_definition_id
      JOIN employees e ON e.id = a.employee_id
      JOIN companies c ON c.id = a.company_id
      ORDER BY a.id DESC`).all(),
    db().prepare("SELECT work_assignment_id, period_key, completed_at FROM work_assignment_completions").all<{work_assignment_id:number;period_key:string;completed_at:string}>(),
    db().prepare(`SELECT tasks.*, employees.name AS employee_name,
      COALESCE((SELECT p.title FROM employee_companies ec JOIN company_structure_positions p ON p.id = ec.position_id
        WHERE ec.employee_id = tasks.employee_id AND ec.company_id = tasks.company_id), '') AS employee_position,
      companies.name AS company_name,
      (SELECT id FROM work_requests WHERE work_requests.task_id = tasks.id) AS request_id,
      (SELECT status FROM work_requests WHERE work_requests.task_id = tasks.id) AS request_status,
      (SELECT u.name || COALESCE(' (' || r.from_department || ')', '') FROM work_requests r LEFT JOIN app_users u ON u.id = r.from_user_id WHERE r.task_id = tasks.id) AS request_from,
      (SELECT ev.actor_name FROM work_request_events ev JOIN work_requests r ON r.id = ev.request_id
        WHERE r.task_id = tasks.id AND ev.action IN ('Sorğu qəbul edildi', 'İcraçı dəyişdirildi') ORDER BY ev.id DESC LIMIT 1) AS request_accepted_by,
      (SELECT i.assigned_by_name FROM incoming_assignments a JOIN incoming_documents i ON i.id = a.incoming_id WHERE a.task_id = tasks.id) AS incoming_assigned_by
      FROM tasks JOIN employees ON employees.id = tasks.employee_id
      LEFT JOIN companies ON companies.id = tasks.company_id
      ORDER BY tasks.created_at DESC, tasks.id DESC`).all(),
    db().prepare(`SELECT task_date_requests.*, tasks.title AS task_title, tasks.employee_id AS employee_id, employees.name AS employee_name
      FROM task_date_requests
      JOIN tasks ON tasks.id = task_date_requests.task_id
      JOIN employees ON employees.id = tasks.employee_id
      ORDER BY task_date_requests.created_at DESC`).all(),
  ]);
  const heads = await departmentHeadIds();
  const employeeRows = (employees.results as Array<Record<string, unknown>>).map((item) => ({ ...item, is_department_head: Number(heads.has(Number(item.id))) }));
  const completedKeys = new Set(workCompletions.results.map((item) => `${item.work_assignment_id}:${item.period_key}`));
  const currentAssignments = (workAssignments.results as Array<Record<string, unknown>>).map((item) => {
    const currentPeriod = periodKey({ frequency: String(item.frequency) });
    return { ...item, period_key: currentPeriod, is_completed: Number(completedKeys.has(`${item.id}:${currentPeriod}`)) };
  });
  return { fixedWorksStart: await getFixedWorksStart(), employees: employeeRows as typeof employees.results, companies: companies.results, recurring: recurring.results, workItems: workItems.results, workAssignments: currentAssignments, workCompletions: workCompletions.results, tasks: await withFiles(await withFiles(await attachAssignerChains(tasks.results as Array<Record<string, unknown>>), "task"), "task_submission", "submission_files"), dateRequests: dateRequests.results };
}

const FREQUENCIES: readonly string[] = [...FIXED_FREQUENCIES, "daily"];
function normalizeDueMonth(frequency: string, dueMonth: unknown) {
  if (!isLongPeriod(frequency) || dueMonth === undefined || dueMonth === null || dueMonth === "") return null;
  const month = Number(dueMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Son tarixin ayı düzgün deyil.");
  return month;
}

function normalizeDueDay(frequency: string, dueDay: unknown) {
  if (dueDay === undefined || dueDay === null) return null;
  const day = Number(dueDay);
  if (!Number.isInteger(day) || day < 1 || day > (frequency === "weekly" ? 7 : 31)) throw new Error("Son tarix düzgün deyil.");
  return day;
}

export async function createWorkItem(input: { title: string; description?: string; frequency?: string; dueDay?: number }) {
  const title = input.title?.trim();
  const frequency = input.frequency || "monthly";
  if (!title) throw new Error("İşin adını yazın.");
  if (!FREQUENCIES.includes(frequency)) throw new Error("Dövr seçimi düzgün deyil.");
  await db().prepare("INSERT INTO work_definitions (title, description, frequency, due_day, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(title, input.description?.trim() || null, frequency, normalizeDueDay(frequency, input.dueDay), new Date().toISOString()).run();
}

export async function updateWorkItem(input: { id: number; frequency?: string; dueDay?: number | null; dueMonth?: number | null; title?: string; description?: string | null }) {
  const current = await db().prepare("SELECT title, frequency, due_day FROM work_definitions WHERE id = ?").bind(input.id).first<{title:string;frequency:string;due_day:number|null}>();
  if (!current) throw new Error("İş tapılmadı.");
  // Versiya 2.90: the admin corrects a work's name and description; the new text shows at once for everyone it is assigned to.
  if (input.title !== undefined) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("İşin adını yazın.");
    await db().prepare("UPDATE work_definitions SET title = ?, description = ? WHERE id = ?").bind(title, String(input.description ?? "").trim() || null, input.id).run();
    return { before: current.title, after: title };
  }
  const frequency = input.frequency || current.frequency;
  if (!FREQUENCIES.includes(frequency)) throw new Error("Dövr seçimi düzgün deyil.");
  if (hasFixedDue(frequency) && (input.dueDay != null || input.dueMonth != null)) throw new Error("Rüblük işin son tarixi dəyişmir: növbəti rübün 1-ci ayının 20-si.");
  if (input.dueMonth !== undefined) await db().prepare("UPDATE work_definitions SET due_month = ? WHERE id = ?").bind(normalizeDueMonth(frequency, input.dueMonth), input.id).run();
  // Switching monthly <-> weekly resets the deadline to that frequency's default, since the numbers mean different things.
  const dueDay = input.dueDay !== undefined ? input.dueDay : frequency === current.frequency ? current.due_day : null;
  await db().prepare("UPDATE work_definitions SET frequency = ?, due_day = ? WHERE id = ?").bind(frequency, normalizeDueDay(frequency, dueDay), input.id).run();
}

// Versiya 2.90: a work is deleted only while nobody has it — taking it from the people first keeps anyone's marks from vanishing by mistake.
export async function deleteWorkItem(id: number) {
  const current = await db().prepare("SELECT title FROM work_definitions WHERE id = ?").bind(id).first<{ title: string }>();
  if (!current) throw new Error("İş tapılmadı.");
  const assigned = await db().prepare("SELECT COUNT(*) AS n FROM work_assignments WHERE work_definition_id = ?").bind(id).first<{ n: number }>();
  if (Number(assigned?.n || 0) > 0) throw new Error("Bu iş işçilərə təyin edilib — əvvəlcə işi işçilərdən götürün.");
  await db().prepare("DELETE FROM work_definition_companies WHERE work_definition_id = ?").bind(id).run();
  await db().prepare("DELETE FROM work_definitions WHERE id = ?").bind(id).run();
  return current.title;
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

// Marks one period (a month or a week column) done. A period can be ticked once its window has opened, also after the deadline
// (it then shows as done late); future periods stay closed.
// Versiya 2.89: fixed works count from this day on (app_settings, set by the admin); earlier periods are not counted.
export async function getFixedWorksStart() {
  const row = await db().prepare("SELECT value FROM app_settings WHERE key = 'fixed_works_start'").first<{ value: string | null }>();
  return /^\d{4}-\d{2}-\d{2}$/.test(String(row?.value || "")) ? String(row?.value) : DEFAULT_FIXED_START;
}

export async function setFixedWorksStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error("Tarix düzgün deyil.");
  await db().prepare("INSERT INTO app_settings (key, value) VALUES ('fixed_works_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(value).run();
}

async function fixedAssignment(assignmentId: number, employeeId: number | null) {
  if (!assignmentId) throw new Error("Sabit iş seçilməyib.");
  const statement = employeeId
    ? db().prepare(`SELECT a.id, a.created_at, d.title, d.frequency, d.due_day, d.due_month FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ? AND a.employee_id = ?`).bind(assignmentId, employeeId)
    : db().prepare(`SELECT a.id, a.created_at, d.title, d.frequency, d.due_day, d.due_month FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ?`).bind(assignmentId);
  const assignment = await statement.first<{id:number;created_at:string|null;title:string;frequency:string;due_day:number|null;due_month:number|null}>();
  if (!assignment) throw new Error("Bu sabit iş sizə təyin edilməyib.");
  return assignment;
}

// Versiya 2.89: a mark put by mistake is taken back — by the person until the period's deadline, afterwards only by the admin
// (employeeId null), so a late work cannot be turned into an on-time one later.
export async function uncompleteWorkAssignment(input: { assignmentId:number; periodKey?:string }, employeeId:number|null) {
  const assignment = await fixedAssignment(input.assignmentId, employeeId);
  const key = String(input.periodKey || "");
  const window = periodWindow(assignment, key);
  if (!window) throw new Error("Dövr seçimi düzgün deyil.");
  if (employeeId && Date.now() >= window.due) throw new Error("Son tarix keçib — icra qeydini yalnız admin geri götürə bilər.");
  const result = await db().prepare("DELETE FROM work_assignment_completions WHERE work_assignment_id = ? AND period_key = ?").bind(assignment.id, key).run();
  if (!result.meta.changes) throw new Error("Bu dövr üzrə icra qeydi yoxdur.");
  return assignment.title;
}

export async function completeWorkAssignment(input: { assignmentId:number; periodKey?:string }, employeeId:number|null) {
  const assignment = await fixedAssignment(input.assignmentId, employeeId);
  const key = String(input.periodKey || "");
  const window = periodWindow(assignment, key);
  if (!window) throw new Error("Dövr seçimi düzgün deyil.");
  if (Date.now() < window.start) throw new Error("Bu dövr hələ açılmayıb.");
  if (!periodCounts(assignment, key, { start: await getFixedWorksStart(), assignedAt: assignment.created_at })) throw new Error("Bu dövr hesablanmır (hesablama başlanğıcından və ya işin təyinindən əvvəldir).");
  await db().prepare("INSERT OR IGNORE INTO work_assignment_completions (work_assignment_id, period_key, completed_at) VALUES (?, ?, ?)")
    .bind(assignment.id, key, new Date().toISOString()).run();
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

export async function getCompanyStructure(companyId: number) {
  await ensureSchema();
  return (await db().prepare("SELECT * FROM company_structure_positions WHERE company_id = ? ORDER BY sort_order, id").bind(companyId).all()).results;
}

export async function createStructurePosition(input: { companyId: number; department: string; title: string; reportsTo?: string | null }) {
  await ensureSchema();
  const department = input.department?.trim();
  const title = input.title?.trim();
  if (!department) throw new Error("Şöbənin adını yazın.");
  if (!title) throw new Error("Vəzifənin adını yazın.");
  const duplicate = await db().prepare("SELECT 1 FROM company_structure_positions WHERE company_id = ? AND lower(title) = lower(?)").bind(input.companyId, title).first();
  if (duplicate) throw new Error("Bu vəzifə artıq siyahıdadır — hər vəzifə yalnız bir dəfə əlavə oluna bilər.");
  const max = await db().prepare("SELECT COALESCE(MAX(sort_order), 0) AS max FROM company_structure_positions WHERE company_id = ?").bind(input.companyId).first<{ max: number }>();
  await db().prepare("INSERT INTO company_structure_positions (company_id, department, title, reports_to, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(input.companyId, department, title, input.reportsTo?.trim() || null, (max?.max || 0) + 1, new Date().toISOString()).run();
  return getCompanyStructure(input.companyId);
}

export async function updateStructurePosition(input: { id: number; department?: string; title?: string; reportsTo?: string | null }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM company_structure_positions WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Vəzifə tapılmadı.");
  const title = input.title?.trim() || String(current.title);
  const duplicate = await db().prepare("SELECT 1 FROM company_structure_positions WHERE company_id = ? AND id != ? AND lower(title) = lower(?)").bind(current.company_id, input.id, title).first();
  if (duplicate) throw new Error("Bu vəzifə artıq siyahıdadır — hər vəzifə yalnız bir dəfə əlavə oluna bilər.");
  await db().prepare("UPDATE company_structure_positions SET department = ?, title = ?, reports_to = ? WHERE id = ?")
    .bind(input.department?.trim() || current.department, title, input.reportsTo === undefined ? current.reports_to : (input.reportsTo?.trim() || null), input.id).run();
  return getCompanyStructure(Number(current.company_id));
}

export async function deleteStructurePosition(id: number) {
  const current = await db().prepare("SELECT company_id FROM company_structure_positions WHERE id = ?").bind(id).first<{ company_id: number }>();
  if (!current) throw new Error("Vəzifə tapılmadı.");
  await db().prepare("UPDATE employee_companies SET position_id = NULL WHERE position_id = ?").bind(id).run();
  await db().prepare("DELETE FROM company_structure_positions WHERE id = ?").bind(id).run();
  return getCompanyStructure(current.company_id);
}

// companyPositions: { [companyId]: structurePositionId } — the employee's position inside each company's structure. When omitted, existing positions are kept.
async function setEmployeeCompanies(employeeId: number, companyIds: number[], companyPositions?: Record<string, number | null>) {
  const previous = new Map(((await db().prepare("SELECT company_id, position_id FROM employee_companies WHERE employee_id = ?").bind(employeeId).all<{ company_id: number; position_id: number | null }>()).results).map((row) => [row.company_id, row.position_id]));
  await db().prepare("DELETE FROM employee_companies WHERE employee_id = ?").bind(employeeId).run();
  for (const companyId of companyIds) {
    const positionId = companyPositions ? Number(companyPositions[String(companyId)]) || null : previous.get(companyId) ?? null;
    await db().prepare("INSERT OR IGNORE INTO employee_companies (employee_id, company_id, position_id) VALUES (?, ?, (SELECT id FROM company_structure_positions WHERE id = ? AND company_id = ?))").bind(employeeId, companyId, positionId, companyId).run();
  }
}

export async function createEmployee(input: { name: string; position?: string; email?: string; mainCompanyId?: number | null; companyIds?: number[]; companyPositions?: Record<string, number | null>; avatarKey?: string; hiddenSections?: unknown; companyPermissions?: unknown }) {
  await ensureSchema();
  const hidden = parseHiddenSections(input.hiddenSections);
  const result = await db().prepare("INSERT INTO employees (name, position, email, main_company_id, active, avatar_key, hidden_sections, company_permissions, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)")
    .bind(input.name, input.position || "Personal", input.email || null, Number(input.mainCompanyId) || null, input.avatarKey || null, hidden.length ? JSON.stringify(hidden) : null, JSON.stringify(firmPermissionsFor(input.companyPermissions, input.companyIds ?? [])), new Date().toISOString()).run();
  const employeeId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  if (input.companyIds?.length) await setEmployeeCompanies(employeeId, input.companyIds, input.companyPositions);
  return employeeId;
}

export async function updateEmployee(input: { id: number; name?: string; position?: string; email?: string; mainCompanyId?: number | null; active?: boolean; companyIds?: number[]; companyPositions?: Record<string, number | null>; avatarKey?: string | null; hiddenSections?: unknown; companyPermissions?: unknown }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM employees WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("İstifadəçi tapılmadı.");
  await db().prepare("UPDATE employees SET name = ?, position = ?, email = ?, main_company_id = ?, active = ?, avatar_key = ? WHERE id = ?")
    .bind(input.name ?? current.name, input.position ?? current.position, input.email ?? current.email, input.mainCompanyId === undefined ? current.main_company_id : (Number(input.mainCompanyId) || null), input.active === undefined ? current.active : Number(input.active), input.avatarKey === undefined ? current.avatar_key : input.avatarKey, input.id).run();
  if (input.companyIds !== undefined) await setEmployeeCompanies(input.id, input.companyIds, input.companyPositions);
  if (input.hiddenSections !== undefined) {
    const hidden = parseHiddenSections(input.hiddenSections);
    await db().prepare("UPDATE employees SET hidden_sections = ? WHERE id = ?").bind(hidden.length ? JSON.stringify(hidden) : null, input.id).run();
  }
  // Versiya 2.99: the rights per firm — only for the firms the user works in (a removed firm takes its rights with it).
  if (input.companyPermissions !== undefined || input.companyIds !== undefined) {
    const companyIds = input.companyIds ?? (await db().prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(input.id).all<{ company_id: number }>()).results.map((r) => r.company_id);
    await db().prepare("UPDATE employees SET company_permissions = ? WHERE id = ?").bind(JSON.stringify(firmPermissionsFor(input.companyPermissions ?? current.company_permissions, companyIds)), input.id).run();
  }
}

function firmPermissionsFor(raw: unknown, companyIds: number[]) {
  const all = parseCompanyPermissions(raw);
  return Object.fromEntries(companyIds.map(String).filter((id) => all[id]).map((id) => [id, all[id]]));
}

export async function deleteEmployee(id: number) {
  const employee = await db().prepare("SELECT active FROM employees WHERE id = ?").bind(id).first<{ active: number }>();
  if (!employee) throw new Error("İstifadəçi tapılmadı.");
  if (employee.active) throw new Error("İstifadəçini silməzdən əvvəl deaktiv edin.");
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

export async function updateTask(input: { id: number; actorName?: string; status?: string; evaluation?: number; evaluationNote?: string; userMode?: boolean; submissionFiles?: unknown; submissionNote?: string }) {
  const submissionFiles = parseFiles(input.submissionFiles);
  const current = await db().prepare("SELECT * FROM tasks WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Tapşırıq tapılmadı.");
  const linkedRequest = await requestForTask(input.id);
  if (input.userMode) {
    const changeCount = Number(current.employee_status_changed || 0);
    if (changeCount >= 2) throw new Error("Bu tapşırıq artıq təqdim edilib və status dəyişdirilə bilməz.");
    const validTransition = (current.status === "Yeni" && input.status === "İcradadır") ||
      ((current.status === "İcradadır" || current.status === "Geri qaytarılıb") && input.status === "Təqdim edilib");
    if (!validTransition) throw new Error("Status yalnız “Yeni” → “İcradadır” → “Təqdim edilib” ardıcıllığı ilə dəyişə bilər.");
    if (input.status === "Təqdim edilib" && current.attachment_key && !linkedRequest && !submissionFiles.length && !current.submission_attachment_key)
      throw new Error("Tapşırıqla göndərilən faylı doldurub yükləməlisiniz.");
  } else if (input.status === "Təsdiqlənib") {
    const score = Number(input.evaluation);
    if (current.status !== "Təqdim edilib") throw new Error("Yalnız təqdim edilmiş tapşırıq təsdiqlənə bilər.");
    if (linkedRequest && linkedRequest.status !== "Qiymətləndirmə gözləyir") throw new Error("Sorğudan yaranan tapşırıq yalnız sorğunu göndərən onu bağladıqdan sonra qiymətləndirilə bilər.");
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
  const submittedAt = status === "Təqdim edilib" && current.status !== "Təqdim edilib" ? new Date().toISOString() : current.submitted_at ?? null;
  await db().prepare(`UPDATE tasks SET status = ?, evaluation = ?, evaluation_note = ?, completed_at = ?, employee_status_changed = ?, submitted_at = ? WHERE id = ?`)
    .bind(
      status,
      input.evaluation ?? current.evaluation,
      input.evaluationNote ?? current.evaluation_note,
      completedAt,
      employeeStatusChanged,
      submittedAt,
      input.id,
    ).run();
  // Versiya 3.04: the work is submitted with up to 10 files; submitting again replaces them.
  if (submissionFiles.length) await setFiles("task_submission", input.id, submissionFiles);
  if (status === "Təsdiqlənib") {
    await db().prepare("UPDATE personal_work_checklist_items SET done = 1 WHERE delegated_task_id = ?").bind(input.id).run();
    await db().prepare("UPDATE task_checklist_items SET done = 1 WHERE delegated_task_id = ?").bind(input.id).run();
  }
  if (linkedRequest && input.status && input.status !== current.status) {
    // On submission the answer text written by the assignee (and the file name) becomes the request's answer, shown in Sorğular and on the requester's step.
    const submittedFile = submissionFiles.length ? fileNames(submissionFiles) : current.submission_attachment_name;
    const detail = status === "Təqdim edilib" ? [input.submissionNote?.trim(), submittedFile ? `Fayl: ${submittedFile}` : ""].filter(Boolean).join("\n") || null
      : status === "Geri qaytarılıb" ? input.evaluationNote?.trim() || null
      : status === "Təsdiqlənib" ? `${input.evaluation}/10${input.evaluationNote?.trim() ? `\n${input.evaluationNote.trim()}` : ""}` : null;
    await syncRequestFromTask(input.id, String(status), input.actorName, detail as string | null);
  }
  // A task handed over from a personal work reports its progress back into that work's history.
  if (input.status && input.status !== current.status) {
    const linked = await db().prepare(`SELECT items.personal_work_id, items.title, employees.name AS employee_name
      FROM personal_work_checklist_items AS items
      JOIN tasks ON tasks.id = items.delegated_task_id
      JOIN employees ON employees.id = tasks.employee_id
      WHERE items.delegated_task_id = ?`).bind(input.id).first<{ personal_work_id: number; title: string; employee_name: string }>();
    if (linked) {
      const subject = `${linked.title} — ${linked.employee_name}`;
      if (status === "İcradadır") await recordPersonalWorkEvent(linked.personal_work_id, linked.employee_name, "İşçi tapşırığı icraya aldı", subject);
      else if (status === "Təqdim edilib") await recordPersonalWorkEvent(linked.personal_work_id, linked.employee_name, "İşçi tapşırığı təqdim etdi", subject);
      else if (status === "Təsdiqlənib") await recordPersonalWorkEvent(linked.personal_work_id, input.actorName, "Tapşırıq təsdiqləndi ✓", `${subject} — qiymət ${input.evaluation}/10`);
      else if (status === "Geri qaytarılıb") await recordPersonalWorkEvent(linked.personal_work_id, input.actorName, "Tapşırıq geri qaytarıldı", `${subject}\nSəbəb: ${input.evaluationNote?.trim() || "—"}`);
    }
  }
}

// Versiya 2.82: whoever gave a task approves it (or sends it back) — not only the admin. The tasks a user gives are the steps
// they handed on ("Ver") from their own task or personal work, and, for a firm's director, the tasks of their dərkənar on
// incoming documents. Tasks born from a request stay with Sorğular (the department head scores them there).
export async function tasksGivenBy(user: SessionUser) {
  await ensureSchema();
  const ids = new Set<number>();
  if (user.employeeId) {
    const fromTasks = await db().prepare(`SELECT tci.delegated_task_id AS id FROM task_checklist_items tci JOIN tasks parent ON parent.id = tci.task_id
      WHERE tci.delegated_task_id IS NOT NULL AND parent.employee_id = ?`).bind(user.employeeId).all<{ id: number }>();
    fromTasks.results.forEach((r) => ids.add(Number(r.id)));
    const structure = await companyDepartments();
    const directed = await db().prepare(`SELECT a.task_id AS id, d.company_id FROM incoming_assignments a JOIN incoming_documents d ON d.id = a.incoming_id
      WHERE a.task_id IS NOT NULL`).all<{ id: number; company_id: number }>();
    directed.results.forEach((r) => { if (structure.directorsOf(Number(r.company_id)).has(user.employeeId!)) ids.add(Number(r.id)); });
  }
  const fromWorks = await db().prepare(`SELECT i.delegated_task_id AS id FROM personal_work_checklist_items i JOIN personal_works w ON w.id = i.personal_work_id
    WHERE i.delegated_task_id IS NOT NULL AND w.user_id = ?`).bind(user.id).all<{ id: number }>();
  fromWorks.results.forEach((r) => ids.add(Number(r.id)));
  for (const id of [...ids]) if (await requestForTask(id)) ids.delete(id);
  return ids;
}

export async function canApproveTask(user: SessionUser, taskId: number) {
  return user.role === "admin" || (await tasksGivenBy(user)).has(taskId);
}

export async function deleteTask(id: number, actorName?: string) {
  const task = await db().prepare("SELECT id, status, attachment_key FROM tasks WHERE id = ?").bind(id).first<{ id: number; status: string; attachment_key: string | null }>();
  if (!task) throw new Error("Tapşırıq tapılmadı.");
  if (task.status !== "Yeni") throw new Error("Yalnız “Yeni” statuslu tapşırıq silinə bilər.");
  if (await requestForTask(id)) throw new Error("Bu tapşırıq sorğudan yaranıb — onu Sorğular bölməsindən idarə edin (icraçını dəyişin və ya imtina edin).");
  const linked = await db().prepare("SELECT personal_work_id, title FROM personal_work_checklist_items WHERE delegated_task_id = ?").bind(id).first<{ personal_work_id: number; title: string }>();
  await db().prepare("UPDATE personal_work_checklist_items SET delegated_task_id = NULL, delegated_employee_id = NULL WHERE delegated_task_id = ?").bind(id).run();
  await db().prepare("UPDATE task_checklist_items SET delegated_task_id = NULL, delegated_employee_id = NULL WHERE delegated_task_id = ?").bind(id).run();
  await db().prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  if (linked) await recordPersonalWorkEvent(linked.personal_work_id, actorName, "Həvalə ləğv edildi (tapşırıq silindi)", linked.title);
  await removeFiles("task", id);
  await removeFiles("task_submission", id);
}

export async function getChecklistItems(taskId: number) {
  await ensureSchema();
  const rows = (await db().prepare(`SELECT task_checklist_items.*, delegated_employee.name AS delegated_employee_name, delegated_task.status AS delegated_task_status,
    delegated_task.submission_attachment_key AS delegated_submission_attachment_key, delegated_task.submission_attachment_name AS delegated_submission_attachment_name, delegated_task.submission_attachment_size AS delegated_submission_attachment_size
    FROM task_checklist_items
    LEFT JOIN employees AS delegated_employee ON delegated_employee.id = task_checklist_items.delegated_employee_id
    LEFT JOIN tasks AS delegated_task ON delegated_task.id = task_checklist_items.delegated_task_id
    WHERE task_id = ? ORDER BY id`).bind(taskId).all<Record<string, unknown>>()).results;
  return withFiles(await withFiles(rows, "task_item"), "task_submission", "delegated_submission_files", "delegated_task_id");
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
  const item = await db().prepare("SELECT task_id, delegated_task_id FROM task_checklist_items WHERE id = ?").bind(input.id).first<{ task_id: number; delegated_task_id: number | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım işçiyə həvalə edilib, statusu tapşırığın təsdiqi ilə avtomatik yenilənəcək.");
  await db().prepare("UPDATE task_checklist_items SET done = ? WHERE id = ?").bind(Number(input.done), input.id).run();
  return getChecklistItems(item.task_id);
}

export type DelegateCandidate = { id: number; name: string; position_title: string | null };

// Who the owner of a work/task may hand a step to inside one company, following that company's structure:
// walk down from the owner's position; a position held by someone yields those people, a vacant one is skipped
// and its own subordinates are offered instead (e.g. no "şöbə müdiri" on staff → the director sees that department's staff).
// ownerEmployeeId = null (the admin account, which has no personnel record) keeps the old behaviour: everyone in the company.
// deep = true walks the whole subtree (everyone below, not only the nearest filled level) — used to show a head their staff's works.
export async function getDelegateCandidates(companyId: number | null, ownerEmployeeId: number | null, deep = false): Promise<DelegateCandidate[]> {
  await ensureSchema();
  if (!companyId) return [];
  const members = (await db().prepare(`SELECT e.id, e.name, ec.position_id, p.title AS position_title
    FROM employee_companies ec JOIN employees e ON e.id = ec.employee_id
    LEFT JOIN company_structure_positions p ON p.id = ec.position_id AND p.company_id = ec.company_id
    WHERE ec.company_id = ? AND e.active = 1 ORDER BY e.name`).bind(companyId).all<{ id: number; name: string; position_id: number | null; position_title: string | null }>()).results;
  const toCandidate = (m: (typeof members)[number]) => ({ id: m.id, name: m.name, position_title: m.position_title });
  if (!ownerEmployeeId) return members.map(toCandidate);
  const own = await db().prepare("SELECT position_id FROM employee_companies WHERE employee_id = ? AND company_id = ?").bind(ownerEmployeeId, companyId).first<{ position_id: number | null }>();
  if (!own?.position_id) return [];
  const positions = (await db().prepare("SELECT id, department, title, reports_to FROM company_structure_positions WHERE company_id = ?").bind(companyId).all<{ id: number; department: string; title: string; reports_to: string | null }>()).results;
  const titles = new Set(positions.map((p) => p.title.trim()));
  // "reports_to" holds one or more superiors split by "/"; a department name there (e.g. "Rəhbərlik") means every position of that department.
  const reportsTo = (child: (typeof positions)[number], parent: (typeof positions)[number]) =>
    (child.reports_to || "").split("/").map((part) => part.trim()).filter(Boolean)
      .some((part) => part === parent.title.trim() || (!titles.has(part) && part === parent.department.trim()));
  const start = positions.find((p) => p.id === own.position_id);
  if (!start) return [];
  const result = new Map<number, DelegateCandidate>();
  const visited = new Set<number>([start.id]);
  const queue = positions.filter((p) => p.id !== start.id && reportsTo(p, start));
  while (queue.length) {
    const position = queue.shift()!;
    if (visited.has(position.id)) continue;
    visited.add(position.id);
    const holders = members.filter((m) => m.position_id === position.id && m.id !== ownerEmployeeId);
    holders.forEach((m) => result.set(m.id, toCandidate(m)));
    if (deep || !holders.length) queue.push(...positions.filter((p) => !visited.has(p.id) && reportsTo(p, position)));
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, "az"));
}

export async function getTaskDelegateCandidates(taskId: number) {
  const task = await db().prepare("SELECT employee_id, company_id FROM tasks WHERE id = ?").bind(taskId).first<{ employee_id: number; company_id: number | null }>();
  return task ? getDelegateCandidates(task.company_id, task.employee_id) : [];
}

export async function getPersonalWorkDelegateCandidates(personalWorkId: number) {
  const work = await db().prepare("SELECT w.company_id, u.employee_id FROM personal_works w LEFT JOIN app_users u ON u.id = w.user_id WHERE w.id = ?").bind(personalWorkId).first<{ company_id: number | null; employee_id: number | null }>();
  return work ? getDelegateCandidates(work.company_id, work.employee_id) : [];
}

export async function delegateTaskChecklistItem(input: { id: number; isAdmin: boolean; actorEmployeeId: number | null; actorName?: string; employeeId: number; comment?: string }) {
  await ensureSchema();
  const item = await db().prepare("SELECT * FROM task_checklist_items WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım artıq həvalə edilib.");
  const task = await db().prepare("SELECT * FROM tasks WHERE id = ?").bind(item.task_id).first<Record<string, unknown>>();
  if (!task) throw new Error("Tapşırıq tapılmadı.");
  if (!task.company_id) throw new Error("Həvalə etmək üçün əvvəlcə tapşırığın firması təyin olunmalıdır.");
  const candidates = await getDelegateCandidates(Number(task.company_id), Number(task.employee_id));
  if (!candidates.some((c) => c.id === input.employeeId)) throw new Error("Bu işçi firmanın strukturuna görə sizə tabe deyil.");
  // The new task gets its own copies of the step's files so deleting either side never orphans the other.
  const files = await copyFiles(await filesOf("task_item", input.id));
  const result = await db().prepare(`INSERT INTO tasks
    (employee_id, company_id, title, description, due_at, original_due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?)`)
    .bind(input.employeeId, task.company_id, `${task.title} — ${item.title}`, input.comment?.trim() || null, task.due_at, task.due_at, new Date().toISOString()).run();
  const newTaskId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  if (files.length) await setFiles("task", newTaskId, files);
  await db().prepare("UPDATE task_checklist_items SET delegated_task_id = ?, delegated_employee_id = ? WHERE id = ?").bind(newTaskId, input.employeeId, input.id).run();
  return getChecklistItems(Number(item.task_id));
}

export async function deleteChecklistItem(input: { id: number }) {
  await ensureSchema();
  const item = await db().prepare("SELECT task_id FROM task_checklist_items WHERE id = ?").bind(input.id).first<{ task_id: number }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  await db().prepare("DELETE FROM task_checklist_items WHERE id = ?").bind(input.id).run();
  await removeFiles("task_item", input.id);
  return getChecklistItems(item.task_id);
}

export async function setChecklistItemAttachment(input: { id: number } & StepFilesChange) {
  await ensureSchema();
  const item = await db().prepare("SELECT task_id, delegated_task_id FROM task_checklist_items WHERE id = ?").bind(input.id).first<{ task_id: number; delegated_task_id: number | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addımın faylı dəyişdirilə bilməz.");
  await changeStepFiles("task_item", input.id, input);
  return getChecklistItems(item.task_id);
}

const PERSONAL_WORKS_SQL = `SELECT personal_works.*, app_users.name AS owner_name, app_users.employee_id AS owner_employee_id, companies.name AS company_name
    FROM personal_works
    JOIN app_users ON app_users.id = personal_works.user_id
    LEFT JOIN companies ON companies.id = personal_works.company_id`;

export async function getPersonalWorks(userId: number | null) {
  await ensureSchema();
  const works = userId
    ? (await db().prepare(`${PERSONAL_WORKS_SQL} WHERE personal_works.user_id = ? ORDER BY personal_works.created_at DESC, personal_works.id DESC`).bind(userId).all<Record<string, unknown> & { id: number }>()).results
    : (await db().prepare(`${PERSONAL_WORKS_SQL} ORDER BY personal_works.created_at DESC, personal_works.id DESC`).all<Record<string, unknown> & { id: number }>()).results;
  return withPersonalWorkProgress(works);
}

// Versiya 2.85: a head sees the personal works of everyone below them in the firm's structure (read-only, with notes).
// Per firm: the employees under the viewer's position(s), the whole subtree — so the director sees the whole firm.
export type PersonalWorkViewer = { userId: number; employeeId: number | null; isAdmin: boolean };
async function subordinatesByCompany(employeeId: number) {
  const companies = (await db().prepare("SELECT company_id FROM employee_companies WHERE employee_id = ? AND position_id IS NOT NULL").bind(employeeId).all<{ company_id: number }>()).results;
  const result = new Map<number, Set<number>>();
  for (const { company_id } of companies) {
    const people = await getDelegateCandidates(company_id, employeeId, true);
    if (people.length) result.set(company_id, new Set(people.map((p) => p.id)));
  }
  return result;
}
// A work tied to a firm is seen by the owner's heads in that firm; a work without a firm by their heads in any firm.
function supervises(subordinates: Map<number, Set<number>>, work: Record<string, unknown>) {
  const owner = Number(work.owner_employee_id);
  if (!owner) return false;
  if (work.company_id) return Boolean(subordinates.get(Number(work.company_id))?.has(owner));
  return [...subordinates.values()].some((people) => people.has(owner));
}

export async function getTeamPersonalWorks(viewer: PersonalWorkViewer) {
  await ensureSchema();
  const all = (await db().prepare(`${PERSONAL_WORKS_SQL} WHERE personal_works.user_id != ? ORDER BY personal_works.created_at DESC, personal_works.id DESC`).bind(viewer.userId).all<Record<string, unknown> & { id: number }>()).results;
  if (viewer.isAdmin) return { hasTeam: true, items: await withPersonalWorkProgress(all) };
  if (!viewer.employeeId) return { hasTeam: false, items: [] };
  const subordinates = await subordinatesByCompany(viewer.employeeId);
  if (!subordinates.size) return { hasTeam: false, items: [] };
  return { hasTeam: true, items: await withPersonalWorkProgress(all.filter((work) => supervises(subordinates, work))) };
}

// Versiya 2.94: "Əməkdaşlarımın sabit işləri" — the fixed works of everyone below the head in that firm's structure (the whole
// subtree, as for personal works), with their marks; read-only, since marking stays with the person (completeWorkAssignment).
export async function getTeamFixedWorks(employeeId: number | null) {
  await ensureSchema();
  const none = { hasTeam: false, assignments: [] as Record<string, unknown>[], completions: [] as { work_assignment_id: number; period_key: string; completed_at: string }[] };
  if (!employeeId) return none;
  const subordinates = await subordinatesByCompany(employeeId);
  if (!subordinates.size) return none;
  const [assignments, completions] = await Promise.all([
    db().prepare(`SELECT a.*, d.title, d.description, d.frequency, d.due_day, d.due_month, e.name AS employee_name, c.name AS company_name
      FROM work_assignments a
      JOIN work_definitions d ON d.id = a.work_definition_id
      JOIN employees e ON e.id = a.employee_id
      JOIN companies c ON c.id = a.company_id
      WHERE a.employee_id != ? ORDER BY a.id DESC`).bind(employeeId).all<Record<string, unknown> & { id: number; employee_id: number; company_id: number }>(),
    db().prepare("SELECT work_assignment_id, period_key, completed_at FROM work_assignment_completions").all<{ work_assignment_id: number; period_key: string; completed_at: string }>(),
  ]);
  const team = assignments.results.filter((a) => subordinates.get(Number(a.company_id))?.has(Number(a.employee_id)));
  const ids = new Set(team.map((a) => a.id));
  return { hasTeam: true, assignments: team, completions: completions.results.filter((c) => ids.has(c.work_assignment_id)) };
}

// The owner and the admin may open a work; a head may look at (and write notes on) the works of their staff.
export async function personalWorkAccess(viewer: PersonalWorkViewer, personalWorkId: number): Promise<"owner" | "supervisor" | null> {
  await ensureSchema();
  const work = await db().prepare("SELECT personal_works.user_id, personal_works.company_id, app_users.employee_id AS owner_employee_id FROM personal_works JOIN app_users ON app_users.id = personal_works.user_id WHERE personal_works.id = ?")
    .bind(personalWorkId).first<{ user_id: number; company_id: number | null; owner_employee_id: number | null }>();
  if (!work) return null;
  if (work.user_id === viewer.userId) return "owner";
  if (viewer.isAdmin) return "supervisor";
  if (!viewer.employeeId) return null;
  return supervises(await subordinatesByCompany(viewer.employeeId), work) ? "supervisor" : null;
}

export async function addPersonalWorkNote(input: { personalWorkId: number; actorName: string; text: string }) {
  await ensureSchema();
  const text = input.text.trim();
  if (!text) throw new Error("Qeydi yazın.");
  if (text.length > 2000) throw new Error("Qeyd 2000 simvoldan uzun ola bilməz.");
  await db().prepare("INSERT INTO personal_work_events (personal_work_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(input.personalWorkId, input.actorName, "Rəhbərin qeydi", text, new Date().toISOString()).run();
}

async function withPersonalWorkProgress(works: Array<Record<string, unknown> & { id: number }>) {
  // Who each work's steps were handed to, and how many of that person's steps are done (a step is checked once its task is approved).
  const delegations = (await db().prepare(`SELECT items.personal_work_id AS work_id, employees.id AS employee_id, employees.name AS name, items.done AS done
    FROM personal_work_checklist_items AS items
    JOIN employees ON employees.id = items.delegated_employee_id
    WHERE items.delegated_task_id IS NOT NULL ORDER BY items.id`).all<{ work_id: number; employee_id: number; name: string; done: number }>()).results;
  const sharedByWork = new Map<number, Map<number, { employee_id: number; name: string; total: number; done: number }>>();
  for (const row of delegations) {
    const people = sharedByWork.get(row.work_id) ?? new Map();
    const person = people.get(row.employee_id) ?? { employee_id: row.employee_id, name: row.name, total: 0, done: 0 };
    person.total += 1;
    person.done += row.done ? 1 : 0;
    people.set(row.employee_id, person);
    sharedByWork.set(row.work_id, people);
  }
  // Steps sent to another department (Şöbəyə sorğu) count under that department; a rejected request gives the step back to the owner.
  await ensureRequestSchema();
  const requested = (await db().prepare(`SELECT items.id AS item_id, items.personal_work_id AS work_id, req.to_department AS department, items.done AS done
    FROM personal_work_checklist_items AS items
    JOIN work_requests AS req ON req.id = (SELECT MAX(id) FROM work_requests WHERE personal_work_item_id = items.id)
    WHERE items.delegated_task_id IS NULL AND req.status != 'İmtina edildi' ORDER BY items.id`).all<{ item_id: number; work_id: number; department: string; done: number }>()).results;
  const departmentsByWork = new Map<number, Map<string, { department: string; total: number; done: number }>>();
  for (const row of requested) {
    const departments = departmentsByWork.get(row.work_id) ?? new Map();
    const entry = departments.get(row.department) ?? { department: row.department, total: 0, done: 0 };
    entry.total += 1;
    entry.done += row.done ? 1 : 0;
    departments.set(row.department, entry);
    departmentsByWork.set(row.work_id, departments);
  }
  const requestedItems = new Set(requested.map((row) => row.item_id));
  // The owner's own share: the steps neither handed to anyone nor sent to a department, shown first in the "İcraçılar" column.
  const ownSteps = (await db().prepare("SELECT id, personal_work_id AS work_id, done FROM personal_work_checklist_items WHERE delegated_task_id IS NULL").all<{ id: number; work_id: number; done: number }>()).results;
  const ownByWork = new Map<number, { total: number; done: number }>();
  for (const row of ownSteps) {
    if (requestedItems.has(row.id)) continue;
    const own = ownByWork.get(row.work_id) ?? { total: 0, done: 0 };
    own.total += 1;
    own.done += row.done ? 1 : 0;
    ownByWork.set(row.work_id, own);
  }
  const filesByWork = await filesOfMany("personal_work", works.length <= 50 ? works.map((w) => w.id) : undefined);
  return works.map((work) => ({ ...work, files: filesByWork.get(work.id) ?? [], shared: Array.from(sharedByWork.get(work.id)?.values() ?? []), departments: Array.from(departmentsByWork.get(work.id)?.values() ?? []), own: ownByWork.get(work.id) ?? null }));
}

// Per-work history shown in the "Aç" dialog. Purely informational, so a failed write never blocks the action itself.
export async function recordPersonalWorkEvent(workId: number, actorName: string | null | undefined, action: string, detail?: string | null) {
  try {
    await db().prepare("INSERT INTO personal_work_events (personal_work_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(workId, actorName || "Naməlum", action, detail || null, new Date().toISOString()).run();
  } catch {
    // ignore
  }
}

export async function getPersonalWorkHistory(personalWorkId: number) {
  await ensureSchema();
  const work = await db().prepare(`SELECT personal_works.title, personal_works.status, personal_works.created_at, personal_works.completed_at, app_users.name AS owner_name
    FROM personal_works JOIN app_users ON app_users.id = personal_works.user_id WHERE personal_works.id = ?`).bind(personalWorkId)
    .first<{ title: string; status: string; created_at: string; completed_at: string | null; owner_name: string }>();
  if (!work) throw new Error("İş tapılmadı.");
  type HistoryEvent = { id: number; actor_name: string; action: string; detail: string | null; created_at: string | null };
  const logged = (await db().prepare("SELECT id, actor_name, action, detail, created_at FROM personal_work_events WHERE personal_work_id = ? ORDER BY created_at, id").bind(personalWorkId)
    .all<HistoryEvent>()).results;
  const has = (action: string, detailStart: string | null) => logged.some((event) => event.action === action && (detailStart === null || (event.detail || "").startsWith(detailStart)));

  // Everything that happened before events were logged is rebuilt from the rows themselves. Where the database never stored a
  // time (an employee starting or submitting a task), the step is still listed, in its logical place, without a date.
  const rebuilt: Array<HistoryEvent & { sortAt: string }> = [];
  const add = (sortAt: string, actor: string, action: string, detail: string | null, createdAt: string | null) =>
    rebuilt.push({ id: -(rebuilt.length + 1), actor_name: actor, action, detail, created_at: createdAt, sortAt });

  if (!has("İş yaradıldı", null)) add(work.created_at, work.owner_name, "İş yaradıldı", work.title, work.created_at);
  if ((work.status === "İcradadır" || work.status === "Tamamlanıb") && !has("İş icraya alındı", null)) add(work.created_at, work.owner_name, "İş icraya alındı", null, null);
  if (work.status === "Tamamlanıb" && work.completed_at && !has("İş tamamlandı", null)) add(work.completed_at, work.owner_name, "İş tamamlandı", null, work.completed_at);

  const steps = (await db().prepare("SELECT title, created_at FROM personal_work_checklist_items WHERE personal_work_id = ? ORDER BY id").bind(personalWorkId).all<{ title: string; created_at: string }>()).results;
  for (const step of steps) if (!has("Addım əlavə edildi", step.title)) add(step.created_at, work.owner_name, "Addım əlavə edildi", step.title, step.created_at);

  const tasks = (await db().prepare(`SELECT items.title AS step_title, tasks.status, tasks.created_at, tasks.completed_at, tasks.evaluation, tasks.evaluation_note,
      tasks.description, tasks.attachment_name, employees.name AS employee_name
    FROM personal_work_checklist_items AS items
    JOIN tasks ON tasks.id = items.delegated_task_id
    JOIN employees ON employees.id = tasks.employee_id
    WHERE items.personal_work_id = ? ORDER BY tasks.id`).bind(personalWorkId)
    .all<{ step_title: string; status: string; created_at: string; completed_at: string | null; evaluation: number | null; evaluation_note: string | null; description: string | null; attachment_name: string | null; employee_name: string }>()).results;
  for (const task of tasks) {
    const subject = `${task.step_title} — ${task.employee_name}`;
    const started = task.status !== "Yeni";
    const submitted = task.status === "Təqdim edilib" || task.status === "Təsdiqlənib";
    if (!has("Addım işçiyə verildi", `${task.step_title} → ${task.employee_name}`)) {
      add(task.created_at, work.owner_name, "Addım işçiyə verildi", `${task.step_title} → ${task.employee_name}${task.description ? `\nŞərh: ${task.description}` : ""}${task.attachment_name ? `\nFayl: ${task.attachment_name}` : ""}`, task.created_at);
    }
    if (started && !has("İşçi tapşırığı icraya aldı", subject)) add(task.created_at, task.employee_name, "İşçi tapşırığı icraya aldı", subject, null);
    if (submitted && !has("İşçi tapşırığı təqdim etdi", subject)) add(task.created_at, task.employee_name, "İşçi tapşırığı təqdim etdi", subject, null);
    if (task.status === "Təsdiqlənib" && !has("Tapşırıq təsdiqləndi ✓", subject)) add(task.completed_at || task.created_at, "Rəhbər", "Tapşırıq təsdiqləndi ✓", `${subject} — qiymət ${task.evaluation ?? "—"}/10`, task.completed_at);
    if (task.status === "Geri qaytarılıb" && !has("Tapşırıq geri qaytarıldı", subject)) add(task.created_at, "Rəhbər", "Tapşırıq geri qaytarıldı", `${subject}\nSəbəb: ${task.evaluation_note?.trim() || "—"}`, null);
  }

  // Dated events keep their real time; the undated rebuilt ones sit right after the moment they logically follow.
  const all = [...logged.map((event) => ({ ...event, sortAt: event.created_at || "" })), ...rebuilt];
  return all.map((event, index) => ({ event, index })).sort((a, b) => a.event.sortAt.localeCompare(b.event.sortAt) || a.index - b.index).map(({ event }) => {
    const { sortAt, ...rest } = event;
    void sortAt;
    return rest;
  });
}

export async function createPersonalWork(input: { userId: number; actorName?: string; title: string; description?: string; companyId?: number; dueAt?: string; files?: FileRef[] }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İşin adını yazın.");
  const result = await db().prepare(`INSERT INTO personal_works (user_id, title, description, company_id, due_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'Yeni', ?)`)
    .bind(input.userId, title, input.description?.trim() || null, input.companyId || null, input.dueAt || null, new Date().toISOString()).run();
  const workId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  // Versiya 3.04: up to 10 files (db/attachments.ts).
  if (input.files?.length) await setFiles("personal_work", workId, input.files);
  await recordPersonalWorkEvent(workId, input.actorName, "İş yaradıldı", `${title}${input.files?.length ? `\nFayl: ${fileNames(input.files)}` : ""}`);
  // Versiya 3.05: the work starts with its first step — its name, description and copies of its files — so it can be done,
  // handed to an employee or sent to a department straight away. Later edits of the work do not change the step.
  // Versiya 3.09: it is the work's main step (auto_created) — it is only edited, and goes only with the work itself.
  const step = await db().prepare("INSERT INTO personal_work_checklist_items (personal_work_id, title, description, done, created_at, auto_created) VALUES (?, ?, ?, 0, ?, 1)")
    .bind(workId, title, input.description?.trim() || null, new Date().toISOString()).run();
  const stepId = Number((step as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  const stepFiles = input.files?.length ? await copyFiles(input.files) : [];
  if (stepFiles.length) await setFiles("personal_work_item", stepId, stepFiles);
  await recordPersonalWorkEvent(workId, input.actorName, "Addım əlavə edildi", `${title} (iş yaradılanda avtomatik)${stepFiles.length ? `\nFayl: ${fileNames(stepFiles)}` : ""}`);
}

// What changed in a list of files, for the history.
function filesChange(before: FileRef[], after: FileRef[]) {
  const kept = new Set(after.map((f) => f.key));
  const had = new Set(before.map((f) => f.key));
  const removed = before.filter((f) => !kept.has(f.key));
  const added = after.filter((f) => !had.has(f.key));
  return [added.length ? `Əlavə edildi: ${fileNames(added)}` : "", removed.length ? `Silindi: ${fileNames(removed)}` : ""].filter(Boolean).join("\n");
}

// Versiya 3.02: the files of one's own work may be changed in every status — a completed work too (its other details stay
// fixed once it is completed). Since 3.04 the whole list is sent: the files kept, plus the new ones. The change goes into the history.
export async function updatePersonalWorkFile(input: { id: number; userId: number; actorName?: string; files: FileRef[] }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("İş tapılmadı.");
  if (Number(current.user_id) !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  const { before, after } = await setFiles("personal_work", input.id, input.files);
  const change = filesChange(before, after);
  if (change) await recordPersonalWorkEvent(input.id, input.actorName, "Fayllar dəyişdirildi", change);
}

export async function updatePersonalWork(input: { id: number; userId: number; actorName?: string; title: string; description?: string; companyId?: number | null; dueAt?: string | null; files?: FileRef[] }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("İş tapılmadı.");
  if (Number(current.user_id) !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  if (current.status === "Tamamlanıb") throw new Error("Tamamlanmış iş redaktə edilə bilməz.");
  const title = input.title?.trim();
  if (!title) throw new Error("İşin adını yazın.");
  await db().prepare(`UPDATE personal_works SET title = ?, description = ?, company_id = ?, due_at = ? WHERE id = ?`)
    .bind(title, input.description?.trim() || null, input.companyId ?? null, input.dueAt ?? null, input.id).run();
  let change = "";
  if (input.files) {
    const { before, after } = await setFiles("personal_work", input.id, input.files);
    change = filesChange(before, after);
  }
  await recordPersonalWorkEvent(input.id, input.actorName, "İş məlumatları redaktə edildi", `${title}${change ? `\n${change}` : ""}`);
}

export async function updatePersonalWorkStatus(input: { id: number; userId: number; actorName?: string; status: string }) {
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
  await recordPersonalWorkEvent(input.id, input.actorName, input.status === "Tamamlanıb" ? "İş tamamlandı" : "İş icraya alındı");
}

export async function deletePersonalWork(input: { id: number; userId: number }) {
  await ensureSchema();
  const current = await db().prepare("SELECT user_id, status FROM personal_works WHERE id = ?").bind(input.id).first<{ user_id: number; status: string }>();
  if (!current) throw new Error("İş tapılmadı.");
  if (current.user_id !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  if (current.status !== "Yeni") throw new Error("Yalnız “Yeni” statuslu iş silinə bilər.");
  const steps = (await db().prepare("SELECT id FROM personal_work_checklist_items WHERE personal_work_id = ?").bind(input.id).all<{ id: number }>()).results;
  await db().prepare("DELETE FROM personal_works WHERE id = ?").bind(input.id).run();
  await removeFiles("personal_work", input.id);
  for (const step of steps) await removeFiles("personal_work_item", step.id);
}

export async function getPersonalWorkChecklist(personalWorkId: number) {
  await ensureSchema();
  await ensureRequestSchema();
  // Each step also carries its latest request to another department (Sorğular): status, handler, answer text and file.
  const rows = (await db().prepare(`SELECT personal_work_checklist_items.*, delegated_employee.name AS delegated_employee_name, delegated_task.status AS delegated_task_status,
    delegated_task.submission_attachment_key AS delegated_submission_attachment_key, delegated_task.submission_attachment_name AS delegated_submission_attachment_name, delegated_task.submission_attachment_size AS delegated_submission_attachment_size,
    req.id AS request_id, req.status AS request_status, req.to_department AS request_department, req.reject_reason AS request_reject_reason, req.desired_due_at AS request_due_at, req.agreed_due_at AS request_agreed_due_at,
    req_assignee.name AS request_assignee_name, req.task_id AS request_task_id, req_task.submission_attachment_key AS request_answer_key, req_task.submission_attachment_name AS request_answer_name, req_task.submission_attachment_size AS request_answer_size,
    (SELECT detail FROM work_request_events WHERE request_id = req.id AND action = 'Sorğu cavablandı' ORDER BY id DESC LIMIT 1) AS request_answer
    FROM personal_work_checklist_items
    LEFT JOIN employees AS delegated_employee ON delegated_employee.id = personal_work_checklist_items.delegated_employee_id
    LEFT JOIN tasks AS delegated_task ON delegated_task.id = personal_work_checklist_items.delegated_task_id
    LEFT JOIN work_requests AS req ON req.id = (SELECT MAX(id) FROM work_requests WHERE personal_work_item_id = personal_work_checklist_items.id)
    LEFT JOIN employees AS req_assignee ON req_assignee.id = req.assignee_employee_id
    LEFT JOIN tasks AS req_task ON req_task.id = req.task_id
    WHERE personal_work_id = ? ORDER BY personal_work_checklist_items.id`).bind(personalWorkId).all<Record<string, unknown>>()).results;
  // The pending score is the other department's matter; for the requester the request is simply closed.
  // Versiya 3.04: every file — the step's own, what the person it was handed to submitted, the request's answer.
  const withOwn = await withFiles(rows, "personal_work_item");
  const withDelegated = await withFiles(withOwn, "task_submission", "delegated_submission_files", "delegated_task_id");
  const withAnswer = await withFiles(withDelegated, "task_submission", "request_answer_files", "request_task_id");
  return withAnswer.map((row) => (row.request_status === AWAITING_EVALUATION ? { ...row, request_status: "Bağlandı" } : row));
}

// A step's request is "open" until it is closed or rejected; while open the step cannot be deleted, handed to an employee or re-sent.
const OPEN_REQUEST_SQL = "SELECT id, status, to_department FROM work_requests WHERE personal_work_item_id = ? AND status NOT IN ('Bağlandı', 'İmtina edildi', ?) ORDER BY id DESC LIMIT 1";
async function openRequestOfItem(itemId: number) {
  await ensureRequestSchema();
  return db().prepare(OPEN_REQUEST_SQL).bind(itemId, AWAITING_EVALUATION).first<{ id: number; status: string; to_department: string }>();
}

// Departments of the work's firm a step's request can go to (every one except the sender's own) — empty when the work has no firm.
export async function getPersonalWorkRequestTargets(personalWorkId: number, employeeId: number | null) {
  await ensureSchema();
  const work = await db().prepare("SELECT company_id FROM personal_works WHERE id = ?").bind(personalWorkId).first<{ company_id: number | null }>();
  if (!work?.company_id) return { departments: [] as string[], ownDepartment: null as string | null };
  const lookup = await companyDepartments();
  const ownDepartment = lookup.departmentOf(work.company_id, employeeId);
  return { departments: lookup.departmentsOf(work.company_id).map((d) => d.name).filter((name) => name !== ownDepartment), ownDepartment };
}

// Versiya 3.05: what goes with a step when it is handed on or sent as a request — the list chosen in the dialog (the step's files
// kept there, plus newly uploaded ones), or all the step's files when no list is given. The step's own files go as copies, so
// deleting either side never orphans the other; the step itself keeps its files whatever was sent.
async function stepFilesToSend(itemId: number, chosen?: FileRef[]) {
  const own = await filesOf("personal_work_item", itemId);
  if (!chosen) return copyFiles(own);
  const ownKeys = new Set(own.map((f) => f.key));
  const sent: FileRef[] = [];
  for (const f of chosen) {
    if (!ownKeys.has(f.key)) { sent.push(f); continue; }
    const [copy] = await copyFiles([f]);
    if (copy) sent.push(copy);
  }
  return sent;
}

// Sends a step of "İşlərim" as a request to another department of the work's firm. It is an ordinary request (Sorğular);
// the step only keeps the link, shows the progress and the answer, and the owner ticks it off once satisfied.
export async function requestPersonalWorkChecklistItem(user: SessionUser, input: { id: number; toDepartment: string; title?: string; description?: string; desiredDueAt?: string; files?: FileRef[] }) {
  await ensureSchema();
  const item = await db().prepare("SELECT * FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  const work = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(item.personal_work_id).first<Record<string, unknown>>();
  if (!work) throw new Error("İş tapılmadı.");
  if (Number(work.user_id) !== user.id) throw new Error("Bu iş sizə aid deyil.");
  if (work.status !== "İcradadır") throw new Error("Yalnız icraya alınmış işdən sorğu göndərmək olar.");
  if (!work.company_id) throw new Error("Sorğu göndərmək üçün əvvəlcə işin firmasını seçin.");
  if (item.done) throw new Error("Tamamlanmış addım üçün sorğu göndərmək olmaz.");
  if (item.delegated_task_id) throw new Error("Bu addım artıq işçiyə həvalə edilib.");
  const open = await openRequestOfItem(input.id);
  if (open) throw new Error(`Bu addım üzrə ${open.to_department} şöbəsinə göndərilmiş sorğu hələ açıqdır (${open.status}).`);
  const files = await stepFilesToSend(input.id, input.files);
  await createRequest(user, {
    companyId: Number(work.company_id),
    toDepartment: input.toDepartment,
    title: input.title?.trim() || `${work.title} — ${item.title}`,
    description: input.description,
    desiredDueAt: input.desiredDueAt,
    files,
    personalWorkItemId: input.id,
  });
  return getPersonalWorkChecklist(Number(item.personal_work_id));
}

export async function createPersonalWorkChecklistItem(input: { personalWorkId: number; actorName?: string; title: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İş addımının adını yazın.");
  const work = await db().prepare("SELECT status FROM personal_works WHERE id = ?").bind(input.personalWorkId).first<{ status: string }>();
  if (!work) throw new Error("İş tapılmadı.");
  if (work.status === "Tamamlanıb") throw new Error("Tamamlanmış işə yeni addım əlavə etmək olmaz.");
  await db().prepare("INSERT INTO personal_work_checklist_items (personal_work_id, title, done, created_at) VALUES (?, ?, 0, ?)")
    .bind(input.personalWorkId, title, new Date().toISOString()).run();
  await recordPersonalWorkEvent(input.personalWorkId, input.actorName, "Addım əlavə edildi", title);
  return getPersonalWorkChecklist(input.personalWorkId);
}

export async function togglePersonalWorkChecklistItem(input: { id: number; actorName?: string; done: boolean }) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, title FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; title: string }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım işçiyə həvalə edilib, statusu tapşırığın təsdiqi ilə avtomatik yenilənəcək.");
  const openRequest = await openRequestOfItem(input.id);
  if (openRequest) throw new Error(`Bu addım üzrə ${openRequest.to_department} şöbəsinə sorğu göndərilib — cavabı qəbul edəndə ✓ avtomatik qoyulacaq.`);
  const work = await db().prepare("SELECT status FROM personal_works WHERE id = ?").bind(item.personal_work_id).first<{ status: string }>();
  if (!work) throw new Error("İş tapılmadı.");
  if (work.status !== "İcradadır") throw new Error("Yalnız icraya alınmış işdə addımlar ✓ edilə bilər.");
  await db().prepare("UPDATE personal_work_checklist_items SET done = ? WHERE id = ?").bind(Number(input.done), input.id).run();
  await recordPersonalWorkEvent(item.personal_work_id, input.actorName, input.done ? "Addım tamamlandı ✓" : "Addımdan ✓ götürüldü", item.title);
  // Every step done finishes the work automatically — no separate "Tamamla" click needed once the checklist itself says so.
  if (input.done) {
    const remaining = await db().prepare("SELECT COUNT(*) AS count FROM personal_work_checklist_items WHERE personal_work_id = ? AND done = 0").bind(item.personal_work_id).first<{ count: number }>();
    if (!remaining?.count) {
      await db().prepare("UPDATE personal_works SET status = 'Tamamlanıb', completed_at = ? WHERE id = ?").bind(new Date().toISOString(), item.personal_work_id).run();
      await recordPersonalWorkEvent(item.personal_work_id, input.actorName, "İş tamamlandı", "Bütün addımlar ✓ edildiyi üçün avtomatik tamamlandı");
    }
  }
  return getPersonalWorkChecklist(item.personal_work_id);
}

export async function delegatePersonalWorkChecklistItem(input: { id: number; userId: number; actorName?: string; employeeId: number; comment?: string; files?: FileRef[] }) {
  await ensureSchema();
  const item = await db().prepare("SELECT * FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Bu addım artıq həvalə edilib.");
  const openRequest = await openRequestOfItem(input.id);
  if (openRequest) throw new Error(`Bu addım üzrə ${openRequest.to_department} şöbəsinə sorğu göndərilib — sorğu bağlanana və ya geri çağırılana qədər işçiyə verilə bilməz.`);
  const work = await db().prepare("SELECT * FROM personal_works WHERE id = ?").bind(item.personal_work_id).first<Record<string, unknown>>();
  if (!work) throw new Error("İş tapılmadı.");
  if (Number(work.user_id) !== input.userId) throw new Error("Bu iş sizə aid deyil.");
  if (work.status !== "İcradadır") throw new Error("Yalnız icraya alınmış işdə addım işçiyə həvalə edilə bilər.");
  if (!work.company_id) throw new Error("Həvalə etmək üçün əvvəlcə işin firmasını seçin.");
  if (!work.due_at) throw new Error("Həvalə etmək üçün əvvəlcə işin son tarixini təyin edin.");
  if (!(await getPersonalWorkDelegateCandidates(Number(work.id))).some((c) => c.id === input.employeeId)) throw new Error("Bu işçi firmanın strukturuna görə sizə tabe deyil.");
  // The task gets the files chosen in the dialog (Versiya 3.05; the step's ones as copies) — never the work's own.
  const files = await stepFilesToSend(input.id, input.files);
  const result = await db().prepare(`INSERT INTO tasks
    (employee_id, company_id, title, description, due_at, original_due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?)`)
    .bind(input.employeeId, work.company_id, `${work.title} — ${item.title}`, input.comment?.trim() || null, work.due_at, work.due_at, new Date().toISOString()).run();
  const taskId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  if (files.length) await setFiles("task", taskId, files);
  await db().prepare("UPDATE personal_work_checklist_items SET delegated_task_id = ?, delegated_employee_id = ? WHERE id = ?").bind(taskId, input.employeeId, input.id).run();
  const employee = await db().prepare("SELECT name FROM employees WHERE id = ?").bind(input.employeeId).first<{ name: string }>();
  const note = input.comment?.trim();
  await recordPersonalWorkEvent(Number(item.personal_work_id), input.actorName, "Addım işçiyə verildi", `${item.title} → ${employee?.name || "işçi"}${note ? `\nŞərh: ${note}` : ""}${files.length ? `\nFayl: ${fileNames(files)}` : ""}`);
  return getPersonalWorkChecklist(Number(item.personal_work_id));
}

// Versiya 3.05: a step's name and description are edited while the step is still the owner's own — not handed on, no open request.
export async function updatePersonalWorkChecklistItem(input: { id: number; actorName?: string; title: string; description?: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("İş addımının adını yazın.");
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, title, description FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; title: string; description: string | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addım redaktə edilə bilməz.");
  const openRequest = await openRequestOfItem(input.id);
  if (openRequest) throw new Error(`Bu addım üzrə ${openRequest.to_department} şöbəsinə göndərilmiş sorğu hələ açıqdır — addım redaktə edilə bilməz.`);
  const work = await db().prepare("SELECT status FROM personal_works WHERE id = ?").bind(item.personal_work_id).first<{ status: string }>();
  if (work?.status === "Tamamlanıb") throw new Error("Tamamlanmış işin addımı redaktə edilə bilməz.");
  const description = input.description?.trim() || null;
  const before = item.description || null;
  if (title !== item.title || description !== before) {
    await db().prepare("UPDATE personal_work_checklist_items SET title = ?, description = ? WHERE id = ?").bind(title, description, input.id).run();
    const changes = [title !== item.title ? `Ad: ${item.title} → ${title}` : "", description !== before ? `Açıqlama: ${description || "silindi"}` : ""].filter(Boolean).join("\n");
    await recordPersonalWorkEvent(item.personal_work_id, input.actorName, "Addım redaktə edildi", changes);
  }
  return getPersonalWorkChecklist(item.personal_work_id);
}

// Versiya 3.04: a step keeps up to 10 files — new ones are added to the list, one is removed by its key.
export type StepFilesChange = { add?: FileRef[]; removeKey?: string };
async function changeStepFiles(kind: "personal_work_item" | "task_item", id: number, change: StepFilesChange) {
  const current = await filesOf(kind, id);
  const removed = change.removeKey ? current.filter((f) => f.key === change.removeKey) : [];
  const next = [...current.filter((f) => f.key !== change.removeKey), ...(change.add ?? [])];
  await setFiles(kind, id, next);
  return { added: change.add ?? [], removed };
}
export async function setPersonalWorkChecklistItemAttachment(input: { id: number; actorName?: string } & StepFilesChange) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, title FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; title: string }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addımın faylı dəyişdirilə bilməz.");
  const { added, removed } = await changeStepFiles("personal_work_item", input.id, input);
  if (added.length) await recordPersonalWorkEvent(item.personal_work_id, input.actorName, "Fayl əlavə edildi", `${item.title} — ${fileNames(added)}`);
  if (removed.length) await recordPersonalWorkEvent(item.personal_work_id, input.actorName, "Fayl silindi", `${item.title} — ${fileNames(removed)}`);
  return getPersonalWorkChecklist(item.personal_work_id);
}

export async function deletePersonalWorkChecklistItem(input: { id: number; actorName?: string }) {
  await ensureSchema();
  const item = await db().prepare("SELECT personal_work_id, delegated_task_id, attachment_key, title, auto_created FROM personal_work_checklist_items WHERE id = ?").bind(input.id).first<{ personal_work_id: number; delegated_task_id: number | null; attachment_key: string | null; title: string; auto_created: number | null }>();
  if (!item) throw new Error("İş addımı tapılmadı.");
  if (item.auto_created) throw new Error("İşin yaradılanda avtomatik yaranan 1-ci addımı silinmir — o, yalnız iş silinəndə silinir. Onu ✎ ilə redaktə edə bilərsiniz.");
  if (item.delegated_task_id) throw new Error("Həvalə edilmiş addım silinə bilməz.");
  const openRequest = await openRequestOfItem(input.id);
  if (openRequest) throw new Error(`Bu addım üzrə ${openRequest.to_department} şöbəsinə göndərilmiş sorğu hələ açıqdır (${openRequest.status}). Addım sorğu bağlanandan və ya rədd ediləndən sonra silinə bilər; “Yeni” statusda sorğunu geri çağırmaq olar.`);
  await db().prepare("DELETE FROM personal_work_checklist_items WHERE id = ?").bind(input.id).run();
  await removeFiles("personal_work_item", input.id);
  await recordPersonalWorkEvent(item.personal_work_id, input.actorName, "Addım silindi", item.title);
  return getPersonalWorkChecklist(item.personal_work_id);
}

// "1"/"0", true/false or 1/0 from a form; anything else (empty, missing) means "not given".
function yesNo(value: unknown): 1 | 0 | null {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  return null;
}

export type TemplateGroup = "outgoing" | "incoming" | "other_order";
const TEMPLATE_GROUPS: TemplateGroup[] = ["outgoing", "incoming", "other_order"];
const TEMPLATE_GROUP_LABELS: Record<TemplateGroup, string> = { outgoing: "Çıxan sənəd", incoming: "Daxil olan sənəd", other_order: "Kadrlar" };
const templateGroup = (value: unknown): TemplateGroup => (TEMPLATE_GROUPS.includes(value as TemplateGroup) ? (value as TemplateGroup) : "outgoing");

// The template of a document's type: the one of the document's firm and register with that name (Versiya 2.76).
async function findTemplate<T = Record<string, unknown>>(companyId: unknown, group: TemplateGroup, documentType: unknown) {
  const type = String(documentType || "").trim();
  if (!type || !Number(companyId)) return null;
  return db().prepare("SELECT * FROM document_templates WHERE company_id = ? AND template_group = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1")
    .bind(Number(companyId), group, type).first<T>();
}

// Versiya 2.76, once: each template that was shared by all firms becomes one template per active firm — an outgoing one, plus an
// incoming one where it had a folder or naming rule for incoming documents; "Digər əmr" ones go to Kadrlar. The row itself is kept
// for the first firm (so its id stays valid), the others are copies; HR "Digər əmrlər" orders are pointed at their firm's copy.
async function splitSharedTemplates() {
  const legacy = (await db().prepare("SELECT * FROM document_templates WHERE company_id IS NULL ORDER BY id").all<Record<string, unknown>>()).results;
  if (!legacy.length) return;
  const firms = (await db().prepare("SELECT id FROM companies WHERE active = 1 ORDER BY id").all<{ id: number }>()).results.map((row) => row.id);
  if (!firms.length) return;
  const hrOrders = await db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hr_orders'").first();
  for (const template of legacy) {
    const hr = template.template_group === "other_order";
    const groups: TemplateGroup[] = hr ? ["other_order"] : ["outgoing", ...(template.incoming_folder_path || template.incoming_name_pattern ? ["incoming" as const] : [])];
    // Claimed first, so two requests starting at the same moment do not both copy it.
    const claimed = await db().prepare("UPDATE document_templates SET company_id = ?, template_group = ? WHERE id = ? AND company_id IS NULL").bind(firms[0], groups[0], template.id).run();
    if (claimed.meta.changes === 0) continue;
    for (const companyId of firms) {
      for (const group of groups) {
        if (companyId === firms[0] && group === groups[0]) continue;
        const id = await insertTemplateCopy(template, companyId, group, String(template.name));
        if (hr && hrOrders) await db().prepare("UPDATE hr_orders SET kind = ? WHERE grp = 'other' AND company_id = ? AND kind = ?").bind(String(id), companyId, String(template.id)).run();
      }
    }
  }
}

// A copy of a template row (files, folders, rules) under another firm, group or name. The stored files are shared, not duplicated.
async function insertTemplateCopy(source: Record<string, unknown>, companyId: number, group: TemplateGroup, name: string) {
  const columns = (await db().prepare("PRAGMA table_info(document_templates)").all<{ name: string }>()).results.map((c) => c.name).filter((c) => c !== "id");
  const values = columns.map((c) => (c === "company_id" ? companyId : c === "template_group" ? group : c === "name" ? name : c === "created_at" ? new Date().toISOString() : (source[c] ?? null)));
  const inserted = await db().prepare(`INSERT INTO document_templates (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(...values).run();
  return Number(inserted.meta.last_row_id);
}

// A name is unique within one firm and group (the same name may serve another firm, or the other register of the same firm).
async function assertTemplateNameFree(companyId: number, group: TemplateGroup, name: string, exceptId?: number) {
  const clash = await db().prepare("SELECT id FROM document_templates WHERE company_id = ? AND template_group = ? AND lower(trim(name)) = lower(trim(?)) AND id != ? LIMIT 1")
    .bind(companyId, group, name, exceptId ?? 0).first();
  if (clash) {
    const firm = await db().prepare("SELECT name FROM companies WHERE id = ?").bind(companyId).first<{ name: string }>();
    throw new Error(`“${name}” adlı şablon ${firm?.name || "bu firmada"} · ${TEMPLATE_GROUP_LABELS[group]} qrupunda artıq var.`);
  }
}

async function templateCompany(value: unknown) {
  const companyId = Number(value);
  if (!companyId) throw new Error("Firmanı seçin.");
  if (!(await db().prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first())) throw new Error("Firma tapılmadı.");
  return companyId;
}

// Whether a signed copy of this type must come back, from its template; a type with no template keeps the old rule (it is awaited).
async function templateReturnsSignedCopy(companyId: unknown, documentType: unknown): Promise<1 | 0> {
  const row = await findTemplate<{ signed_copy_returns: number | null }>(companyId, "outgoing", documentType);
  return row && !Number(row.signed_copy_returns) ? 0 : 1;
}

// A document stores its own choice only where it differs from its template, so a later change of the template still reaches it.
// Not given keeps what the document had; an empty value ("") drops the document's own choice.
async function signedCopyOverride(companyId: unknown, documentType: unknown, requested: unknown, current: unknown) {
  const wanted = yesNo(requested);
  if (wanted === null) return requested === "" ? null : (current ?? null);
  return wanted === (await templateReturnsSignedCopy(companyId, documentType)) ? null : wanted;
}

// Versiya 2.77: a template's "Aidiyyatı şöbələr" — departments of its own firm's structure (Kadrlar templates have none).
async function templateDepartments(companyId: number, group: TemplateGroup, raw: unknown) {
  if (group === "other_order") return null;
  const chosen = [...new Set((Array.isArray(raw) ? raw : []).map((d) => String(d).trim()).filter(Boolean))];
  if (!chosen.length) return null;
  const known = new Set((await companyDepartments()).departmentsOf(companyId).map((d) => d.name));
  const unknown = chosen.find((d) => !known.has(d));
  if (unknown) throw new Error(`"${unknown}" bu firmanın strukturunda yoxdur.`);
  return JSON.stringify(chosen);
}

const returnDays = (value: unknown) => { const n = Math.round(Number(value)); return Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : null; };

// The admin sees every firm's templates; anyone else only those of the firms they work in.
export async function getDocumentTemplates(user?: SessionUser) {
  await ensureSchema();
  const rows = (await db().prepare("SELECT t.*, c.name AS company_name FROM document_templates t LEFT JOIN companies c ON c.id = t.company_id ORDER BY t.name").all<Record<string, unknown>>()).results;
  // Versiya 2.83: a folder that is not (or no longer) on the server is flagged, so the admin picks it again.
  const missing = (value: unknown) => Boolean(value && folderStore && !folderStore.isDir(String(value)));
  for (const row of rows) {
    row.draft_folder_missing = missing(row.draft_folder_path);
    row.final_folder_missing = missing(row.final_folder_path);
    row.incoming_folder_missing = missing(row.incoming_folder_path);
  }
  const scope = user ? await outgoingCompanyScope(user) : null;
  return scope ? rows.filter((row) => scope.includes(Number(row.company_id))) : rows;
}

type TemplateInput = { signedCopyDays?: unknown; template1Remove?: boolean; template2Remove?: boolean; template3Remove?: boolean; templateGroup?: string; companyId?: unknown; departments?: unknown; name?: string; template1Key?: string; template1Name?: string; template1Size?: number; template1Type?: string; template2Key?: string; template2Name?: string; template2Size?: number; template2Type?: string; template3Key?: string; template3Name?: string; template3Size?: number; template3Type?: string; draftFolderPath?: string; finalFolderPath?: string; fileNamePattern?: string; incomingFolderPath?: string; incomingNamePattern?: string; signedCopyReturns?: unknown };

export async function createDocumentTemplate(input: TemplateInput) {
  await ensureSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Sənədin adını yazın.");
  const companyId = await templateCompany(input.companyId);
  const group = templateGroup(input.templateGroup);
  await assertTemplateNameFree(companyId, group, name);
  const inserted = await db().prepare(`INSERT INTO document_templates
    (name, template1_key, template1_name, template1_size, template1_type, template2_key, template2_name, template2_size, template2_type, template3_key, template3_name, template3_size, template3_type, draft_folder_path, final_folder_path, file_name_pattern, incoming_folder_path, incoming_name_pattern, signed_copy_returns, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, input.template1Key || null, input.template1Name || null, input.template1Size || null, input.template1Type || null, input.template2Key || null, input.template2Name || null, input.template2Size || null, input.template2Type || null, input.template3Key || null, input.template3Name || null, input.template3Size || null, input.template3Type || null, templateFolder(input.draftFolderPath, null), templateFolder(input.finalFolderPath, null), input.fileNamePattern?.trim() || null, templateFolder(input.incomingFolderPath, null), input.incomingNamePattern?.trim() || null, yesNo(input.signedCopyReturns) ?? 1, new Date().toISOString()).run();
  await db().prepare("UPDATE document_templates SET company_id = ?, template_group = ?, signed_copy_days = ?, departments = ? WHERE id = ?").bind(companyId, group, yesNo(input.signedCopyReturns) === 0 ? null : returnDays(input.signedCopyDays), await templateDepartments(companyId, group, input.departments), Number(inserted.meta.last_row_id)).run();
}

// The firm and group of a template stay as they are; "Kopyala" puts it under another firm or group.
export async function updateDocumentTemplate(input: TemplateInput & { id: number }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM document_templates WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Sənəd tapılmadı.");
  const name = input.name?.trim() || String(current.name);
  await assertTemplateNameFree(Number(current.company_id), templateGroup(current.template_group), name, input.id);
  await db().prepare(`UPDATE document_templates SET name = ?, template1_key = ?, template1_name = ?, template1_size = ?, template1_type = ?, template2_key = ?, template2_name = ?, template2_size = ?, template2_type = ?, template3_key = ?, template3_name = ?, template3_size = ?, template3_type = ?, draft_folder_path = ?, final_folder_path = ?, file_name_pattern = ?, incoming_folder_path = ?, incoming_name_pattern = ?, signed_copy_returns = ? WHERE id = ?`)
    .bind(
      name,
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
      input.draftFolderPath !== undefined ? templateFolder(input.draftFolderPath, current.draft_folder_path) : current.draft_folder_path,
      input.finalFolderPath !== undefined ? templateFolder(input.finalFolderPath, current.final_folder_path) : current.final_folder_path,
      input.fileNamePattern !== undefined ? input.fileNamePattern.trim() || null : current.file_name_pattern,
      input.incomingFolderPath !== undefined ? templateFolder(input.incomingFolderPath, current.incoming_folder_path) : current.incoming_folder_path,
      input.incomingNamePattern !== undefined ? input.incomingNamePattern.trim() || null : current.incoming_name_pattern,
      yesNo(input.signedCopyReturns) ?? current.signed_copy_returns ?? 1,
      input.id,
    ).run();
  if (input.departments !== undefined) {
    await db().prepare("UPDATE document_templates SET departments = ? WHERE id = ?").bind(await templateDepartments(Number(current.company_id), templateGroup(current.template_group), input.departments), input.id).run();
  }
  if (input.signedCopyDays !== undefined || yesNo(input.signedCopyReturns) === 0) {
    await db().prepare("UPDATE document_templates SET signed_copy_days = ? WHERE id = ?").bind(yesNo(input.signedCopyReturns) === 0 ? null : returnDays(input.signedCopyDays), input.id).run();
  }
  // A wrongly chosen template file can be taken off (Versiya 2.75) — the slot empties, and the stored copy goes too unless
  // another template (a copy for another firm or group) still uses it.
  for (const slot of [1, 2, 3] as const) {
    if (!input[`template${slot}Remove`] || input[`template${slot}Key`]) continue;
    await db().prepare(`UPDATE document_templates SET template${slot}_key = NULL, template${slot}_name = NULL, template${slot}_size = NULL, template${slot}_type = NULL WHERE id = ?`).bind(input.id).run();
    const key = current[`template${slot}_key`];
    if (!key || !env.FILES) continue;
    const used = await db().prepare("SELECT id FROM document_templates WHERE template1_key = ? OR template2_key = ? OR template3_key = ? LIMIT 1").bind(key, key, key).first();
    if (!used) await env.FILES.delete(String(key));
  }
}

// "Kopyala": the template with its files, folders and rules, under another firm and/or group (and, if wanted, another name).
export async function copyDocumentTemplate(input: { id: number; companyId?: unknown; templateGroup?: unknown; name?: unknown }) {
  await ensureSchema();
  const source = await db().prepare("SELECT * FROM document_templates WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!source) throw new Error("Sənəd tapılmadı.");
  const companyId = await templateCompany(input.companyId);
  const group = templateGroup(input.templateGroup);
  const name = String(input.name || "").trim() || String(source.name);
  await assertTemplateNameFree(companyId, group, name);
  const id = await insertTemplateCopy(source, companyId, group, name);
  // The departments go along where the target firm has departments of the same name; the others are left out (and named).
  const wanted = group === "other_order" ? [] : parseDepartments(source.departments);
  const known = new Set((await companyDepartments()).departmentsOf(companyId).map((d) => d.name));
  const kept = wanted.filter((d) => known.has(d));
  await db().prepare("UPDATE document_templates SET departments = ? WHERE id = ?").bind(kept.length ? JSON.stringify(kept) : null, id).run();
  return { id, droppedDepartments: wanted.filter((d) => !known.has(d)) };
}

export async function deleteDocumentTemplate(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM document_templates WHERE id = ?").bind(id).run();
}

// Documents are kept per firm: an employee only sees and files the outgoing documents of the firms they work in; the admin sees all.
async function outgoingCompanyScope(user: SessionUser): Promise<number[] | null> {
  if (user.role === "admin") return null;
  if (!user.employeeId) return [];
  return (await db().prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(user.employeeId).all<{ company_id: number }>()).results.map((row) => row.company_id);
}

async function outgoingRecord(user: SessionUser, id: number) {
  const record = await db().prepare("SELECT d.*, c.name AS company_name FROM outgoing_documents d LEFT JOIN companies c ON c.id = d.company_id WHERE d.id = ?").bind(id).first<Record<string, unknown>>();
  if (!record) throw new Error("Sənəd tapılmadı.");
  const scope = await outgoingCompanyScope(user);
  if (scope && !scope.includes(Number(record.company_id))) throw new Error("FORBIDDEN");
  return record;
}

function bakuDateIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());
}

async function nextOutgoingNumber(column: "outgoing_no" | "incoming_no", companyId: number) {
  const row = await db().prepare(`SELECT MAX(CAST(${column} AS INTEGER)) AS maxNo FROM outgoing_documents WHERE company_id = ?`).bind(companyId).first<{ maxNo: number | null }>();
  return String((row?.maxNo || 0) + 1).padStart(6, "0");
}

// Çıxan sənədlər visibility (Versiya 2.77, commercial secrecy), as for incoming documents: registrars (section permission) see and
// handle their firms' documents, the firm's director sees all of the firm's; of the related ("aidiyyatı") and informed departments
// only their heads see a document, and the responsible person (who took it out) sees theirs. Other staff do not see it.
function outgoingDepartments(row: Record<string, unknown>) {
  const related = parseDepartments(row.related_departments);
  return related.length ? related : row.sending_department ? [String(row.sending_department)] : [];
}
function outgoingRights(access: IncomingAccess, user: SessionUser, row: Record<string, unknown>) {
  const companyId = Number(row.company_id);
  const may = registrarRights(access, user, row);
  const registrarHere = may.here;
  const director = access.admin || Boolean(user.employeeId && access.structure.directorsOf(companyId).has(user.employeeId));
  const heads = new Set(access.structure.headedBy(companyId, user.employeeId));
  const head = outgoingDepartments(row).some((d) => heads.has(d));
  const informed = parseDepartments(row.informed_departments).some((d) => heads.has(d));
  const responsible = Boolean(user.employeeId && Number(row.responsible_employee_id) === user.employeeId);
  return { registrarHere, may, director, head, informed, responsible, visible: registrarHere || director || head || informed || responsible };
}
async function outgoingAccess(user: SessionUser): Promise<IncomingAccess> {
  return registrarAccess(user, "documents.outgoing");
}

export async function getOutgoingDocuments(user: SessionUser) {
  await ensureSchema();
  const access = await outgoingAccess(user);
  const rows = (await db().prepare(`SELECT d.*, c.name AS company_name, (SELECT name FROM employees WHERE id = d.responsible_employee_id) AS responsible_name,
    (SELECT phone FROM customers cu WHERE cu.voen = d.voen AND trim(COALESCE(d.voen, '')) != '' LIMIT 1) AS card_phone,
    (SELECT signed_copy_returns FROM document_templates t WHERE t.company_id = d.company_id AND t.template_group = 'outgoing' AND lower(trim(t.name)) = lower(trim(d.document_type)) LIMIT 1) AS template_signed_copy_returns
    FROM outgoing_documents d LEFT JOIN companies c ON c.id = d.company_id ORDER BY d.id DESC`).all<Record<string, unknown>>()).results;
  const flag = (value: unknown) => (value === null || value === undefined ? null : Number(value) ? 1 : 0);
  const approvals = await approvalRows("outgoing");
  const approvalsOf = new Map<number, ApprovalRow[]>();
  for (const r of approvals) approvalsOf.set(r.doc_id, [...(approvalsOf.get(r.doc_id) ?? []), r]);
  // A file someone moved or renamed by hand inside the folder is flagged instead of silently giving a broken link.
  return rows.flatMap((row: Record<string, unknown>) => {
    const rights = outgoingRights(access, user, row);
    if (!rights.visible) return [];
    const approval = approvalState("outgoing", row, approvalsOf.get(Number(row.id)) ?? [], access, user, { departments: outgoingDepartments(row) });
    const editable = access.admin || !approval.locked;
    return [{
      ...row, approval,
      related_departments: outgoingDepartments(row),
      informed_departments: parseDepartments(row.informed_departments),
      // The phone is the customer card's (Versiya 2.77); a document without a card keeps what was typed.
      phone: row.card_phone || row.phone,
      draft_missing: Boolean(row.draft_path && folderStore && !folderStore.exists(String(row.draft_path))),
      final_missing: Boolean(row.final_path && folderStore && !folderStore.exists(String(row.final_path))),
      // What "Hazır sənəd" waits for: the other side's signed copy (1) or just a copy of what we sent (0).
      returns_signed_copy: flag(row.signed_copy_returns) ?? flag(row.template_signed_copy_returns) ?? 1,
      // Versiya 2.86: whose bell rings when the signed copy is late — the registrars and the related departments' heads.
      overdue_watch: rights.registrarHere || rights.head,
      can: {
        edit: rights.may.edit && editable,
        upload: rights.registrarHere && (access.admin || !approval.final) && (rights.may.edit || (rights.may.add && !hasOutgoingFile(row, "draft"))),
        uploadFinal: rights.registrarHere && (access.admin || !approval.final) && rights.may.edit,
        remove: access.admin || (rights.may.delete && editable && !hasOutgoingFile(row, "final")),
      },
    }];
  });
}

// The bell (Versiya 2.86): outgoing documents whose signed copy is past its return date and not back yet, for the registrars
// and the related departments' heads.
export async function overdueSignedCopies(user: SessionUser) {
  const today = bakuDateIso();
  return (await outgoingRows(user))
    .filter((d) => d.overdue_watch && d.returns_signed_copy !== 0 && d.return_due_date && String(d.return_due_date) < today && !hasOutgoingFile(d, "final"))
    .map((d) => ({ id: Number(d.id), outgoing_no: d.outgoing_no, organization_name: d.organization_name, document_type: d.document_type, return_due_date: d.return_due_date }))
    .sort((a, b) => String(a.return_due_date).localeCompare(String(b.return_due_date)));
}

// The list rows read as plain records (getOutgoingDocuments spreads the table row into them).
const outgoingRows = async (user: SessionUser) => (await getOutgoingDocuments(user)) as unknown as Array<Record<string, unknown>>;

// Versiya 2.99: where (and which types) this user registers — the page offers only those firms and types.
export async function outgoingRegisterTargets(user: SessionUser) {
  return registerTargets(await outgoingAccess(user));
}
const hasOutgoingFile = (row: Record<string, unknown>, kind: "draft" | "final") => Boolean(row[`${kind}_name`] || row[`${kind}_path`] || row[`${kind}_key`]);

type OutgoingInput = { informedDepartments?: string[]; responsibleEmployeeId?: unknown; returnDueDate?: string | null; relatedDepartments?: string[]; companyId?: number; outgoingDate?: string; incomingNo?: string; incomingDate?: string; sendingDepartment?: string; documentType?: string; sendingMethod?: string; deliveredBy?: string; copies?: string; documentDate?: string; voen?: string; organizationName?: string; phone?: string; note?: string; signedCopyReturns?: unknown };

export async function createOutgoingDocument(user: SessionUser, input: OutgoingInput) {
  await ensureSchema();
  const companyId = Number(input.companyId);
  if (!companyId) throw new Error("Firma seçilməyib.");
  const scope = await outgoingCompanyScope(user);
  if (scope && !scope.includes(companyId)) throw new Error("FORBIDDEN");
  const docType = input.documentType?.trim() || "";
  requireRegisterType(await outgoingAccess(user), companyId, docType);
  const related = JSON.parse(await documentDepartments(companyId, "outgoing", docType, input.relatedDepartments)) as string[];
  const department = related[0];
  const informed = await informedDepartments(companyId, input.informedDepartments, related);
  const phone = (await customerPhoneByVoen(input.voen)) || formatPhone(input.phone) || null;
  // Çıxış No: one continuous sequence per firm, regardless of type — never resets.
  const outgoingNo = await nextOutgoingNumber("outgoing_no", companyId);
  // Sənədin Nömrəsi: its own sequence per firm and document type, starting over at 1 each calendar year, shown as "N/YYYY".
  const year = new Date().getFullYear();
  const yearRows = await db().prepare("SELECT document_number FROM outgoing_documents WHERE company_id = ? AND document_number LIKE ? AND COALESCE(document_type,'') = ?").bind(companyId, `%/${year}`, docType).all<{ document_number: string | null }>();
  let maxDocNumber = 0;
  for (const row of yearRows.results) {
    const parsed = parseInt(String(row.document_number || "").split("/")[0], 10);
    if (!isNaN(parsed) && parsed > maxDocNumber) maxDocNumber = parsed;
  }
  const documentNumber = `${String(maxDocNumber + 1).padStart(3, "0")}/${year}`;
  // Daxil olma No / tarixi are filled when the signed document comes back (saveOutgoingFile), not typed at creation.
  const result = await db().prepare(`INSERT INTO outgoing_documents
    (company_id, outgoing_no, outgoing_date, sending_department, document_type, sending_method, delivered_by, copies, document_number, document_date, voen, organization_name, phone, note, signed_copy_returns, created_at, related_departments, approval_flow, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(companyId, outgoingNo, input.outgoingDate || null, department, docType || null, input.sendingMethod || null, input.deliveredBy || null, input.copies || null, documentNumber, input.documentDate || null, input.voen || null, input.organizationName || null, phone, input.note || null, await signedCopyOverride(companyId, docType, input.signedCopyReturns, null), new Date().toISOString(), JSON.stringify(related), user.id).run();
  const id = Number(result.meta.last_row_id);
  // Versiya 2.75: who takes the document out (answers for the signed copy) and by when that copy must be back.
  const due = await returnDueFor(companyId, docType, await signedCopyOverride(companyId, docType, input.signedCopyReturns, null), input.outgoingDate);
  await db().prepare("UPDATE outgoing_documents SET responsible_employee_id = ?, return_due_date = ?, informed_departments = ? WHERE id = ?").bind(employeeIdOrNull(input.responsibleEmployeeId), due, informed, id).run();
  return { id, outgoingNo };
}

export async function updateOutgoingDocument(user: SessionUser, input: OutgoingInput & { id: number }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM outgoing_documents WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Sənəd tapılmadı.");
  const access = await outgoingAccess(user);
  if (!outgoingRights(access, user, current).may.edit) throw new Error("FORBIDDEN");
  if (!access.admin && (await approvalStateFor("outgoing", current, access, user)).locked) throw new Error("Sənəd artıq təsdiqlənməyə başlayıb — onu yalnız admin dəyişə bilər.");
  // Only the admin moves a document to another firm or types the Daxil olma No / tarixi by hand (they come with the signed copy).
  const companyId = access.admin && input.companyId ? Number(input.companyId) : Number(current.company_id) || null;
  if (!access.admin) { input.incomingNo = undefined; input.incomingDate = undefined; }
  // Related departments must come from the firm's structure (or, since 2.77, from the type's template); a document from before
  // 2.60 may keep its hand-typed department.
  let related = current.related_departments as string | null;
  let department = current.sending_department as string | null;
  const docType = input.documentType ?? current.document_type;
  const typeChanged = input.documentType !== undefined && String(input.documentType || "").trim() !== String(current.document_type || "").trim();
  // A registrar narrowed to some types (Versiya 2.99) may not move a document to a type outside them.
  if (typeChanged && companyId) requireRegisterType(access, companyId, docType, "edit");
  if ((input.relatedDepartments !== undefined || typeChanged) && companyId) {
    related = await documentDepartments(companyId, "outgoing", docType, input.relatedDepartments);
    department = (JSON.parse(related) as string[])[0];
  }
  const informed = input.informedDepartments !== undefined && companyId
    ? await informedDepartments(companyId, input.informedDepartments, parseDepartments(related)) : current.informed_departments;
  const cardPhone = await customerPhoneByVoen(input.voen ?? current.voen);
  // Çıxış No and Sənədin Nömrəsi are system-assigned at creation and stay fixed afterwards, so the sequence they guarantee is never broken by an edit.
  await db().prepare(`UPDATE outgoing_documents SET related_departments = ?, company_id = ?, outgoing_date = ?, incoming_no = ?, incoming_date = ?, sending_department = ?, document_type = ?, sending_method = ?, delivered_by = ?, copies = ?, document_date = ?, voen = ?, organization_name = ?, phone = ?, note = ?, signed_copy_returns = ? WHERE id = ?`)
    .bind(
      related,
      companyId,
      input.outgoingDate ?? current.outgoing_date,
      input.incomingNo ?? current.incoming_no,
      input.incomingDate ?? current.incoming_date,
      department,
      input.documentType ?? current.document_type,
      input.sendingMethod ?? current.sending_method,
      input.deliveredBy ?? current.delivered_by,
      input.copies ?? current.copies,
      input.documentDate ?? current.document_date,
      input.voen ?? current.voen,
      input.organizationName ?? current.organization_name,
      cardPhone || (input.phone === undefined ? current.phone : formatPhone(input.phone) || null),
      input.note ?? current.note,
      await signedCopyOverride(companyId, input.documentType ?? current.document_type, input.signedCopyReturns, current.signed_copy_returns),
      input.id,
    ).run();
  await db().prepare("UPDATE outgoing_documents SET informed_departments = ? WHERE id = ?").bind(informed ?? null, input.id).run();
  if (input.responsibleEmployeeId !== undefined) await db().prepare("UPDATE outgoing_documents SET responsible_employee_id = ? WHERE id = ?").bind(employeeIdOrNull(input.responsibleEmployeeId), input.id).run();
  // The registrar may set the return date by hand (a contract with its own term); an empty value clears it.
  if (input.returnDueDate !== undefined) {
    const value = input.returnDueDate ? String(input.returnDueDate) : "";
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Qaytarılma tarixi düzgün deyil.");
    await db().prepare("UPDATE outgoing_documents SET return_due_date = ? WHERE id = ?").bind(value || null, input.id).run();
  }
}

const employeeIdOrNull = (value: unknown) => (Number(value) > 0 ? Number(value) : null);

// By when a signed copy must be back: the sending date (or today) plus the template's days — none when the type has no days
// or no copy comes back for this document (override: the document's own choice, null = follow the template).
async function returnDueFor(companyId: unknown, documentType: unknown, override: unknown, sendDate: unknown) {
  const row = await findTemplate<{ signed_copy_returns: number | null; signed_copy_days: number | null }>(companyId, "outgoing", documentType);
  if (!row?.signed_copy_days) return null;
  const returns = override === null || override === undefined ? Number(row.signed_copy_returns) !== 0 : Number(override) === 1;
  if (!returns) return null;
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(sendDate || "")) ? String(sendDate) : bakuDateIso();
  const due = new Date(`${base}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + Number(row.signed_copy_days));
  return due.toISOString().slice(0, 10);
}

export async function deleteOutgoingDocument(user: SessionUser, id: number) {
  await ensureSchema();
  const row = await db().prepare("SELECT * FROM outgoing_documents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("Sənəd tapılmadı.");
  const access = await outgoingAccess(user);
  const rights = outgoingRights(access, user, row);
  if (!rights.may.delete) throw new Error("FORBIDDEN");
  if (!access.admin && (await approvalStateFor("outgoing", row, access, user)).locked) throw new Error("Sənəd artıq təsdiqlənməyə başlayıb — onu yalnız admin silə bilər.");
  if (!access.admin && !(rights.registrarHere && !row.final_name && !row.final_path && !row.final_key)) throw new Error("Hazır (imzalı) sənədi yüklənmiş sənədi yalnız admin silə bilər.");
  const current = { draft_key: row.draft_key as string | null, final_key: row.final_key as string | null };
  await db().prepare("DELETE FROM outgoing_documents WHERE id = ?").bind(id).run();
  // Files in the server folders are the archive and stay; only copies kept inside the system go with the record.
  for (const key of [current?.draft_key, current?.final_key]) if (key && env.FILES) await env.FILES.delete(key);
}

// Versiya 2.83: no common root folder any more — each template keeps the full path of a folder the admin picked on the server.
export function getDocumentStorage() {
  return { folderSaving: Boolean(folderStore) };
}

// The folder picker of Şablonlar (admin only): the server's drives, or the sub-folders of one folder.
export function browseServerFolders(dir: string) {
  if (!folderStore) throw new Error("Papka seçmək yalnız proqram öz serverdə işləyəndə mümkündür.");
  const wanted = dir.trim();
  if (!wanted) return { path: "", parent: null, dirs: folderStore.roots() };
  return folderStore.listDirs(wanted);
}

export const DEFAULT_FILE_NAME_PATTERN = "{ÇıxışNo}_{SənədTipi}_{Təşkilat}_{Tarix}";

// "{Çıxış No}", "{cixisno}" and "{ÇIXIŞNO}" all mean the same token, so a template rule survives typing on any keyboard.
function tokenKey(name: string) {
  const map: Record<string, string> = { ç: "c", ı: "i", ə: "e", ğ: "g", ö: "o", ş: "s", ü: "u" };
  return name.toLocaleLowerCase("az-AZ").replace(/[çıəğöşü]/g, (ch) => map[ch]).replace(/[^a-z0-9]/g, "");
}

// Characters Windows refuses in file and folder names.
function cleanPart(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function fillPattern(pattern: string, values: Record<string, string>) {
  const byKey = Object.fromEntries(Object.entries(values).map(([name, value]) => [tokenKey(name), cleanPart(value)]));
  return pattern.split(/(\{[^{}]+\})/).map((part) => {
    const token = part.match(/^\{([^{}]+)\}$/);
    if (token) return byKey[tokenKey(token[1])] ?? part;
    return cleanPart(part);
  }).join("");
}

function tidyName(name: string) {
  return name.replace(/([_\-. ])\1+/g, "$1").replace(/_[-. ]+|[-. ]+_/g, "_").replace(/^[_\-. ]+|[_\-. ]+$/g, "").slice(0, 150).replace(/[. ]+$/, "");
}

function documentValues(record: Record<string, unknown>) {
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  const date = text(record.document_date) || text(record.outgoing_date) || bakuDateIso();
  return {
    ÇıxışNo: text(record.outgoing_no),
    DaxilOlmaNo: text(record.incoming_no),
    SənədNo: text(record.document_number),
    SənədTipi: text(record.document_type),
    Təşkilat: text(record.organization_name),
    VÖEN: text(record.voen),
    Firma: text(record.company_name),
    Şöbə: text(record.sending_department),
    Tarix: date.slice(0, 10),
    İl: date.slice(0, 4),
    Ay: date.slice(5, 7),
  };
}

const BLOCKED_DOCUMENT_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|wsh|jar|apk|dll|sh|bin|app|cpl|reg|hta|lnk)$/i;

// A template's folder: the full path the admin picked on the server. Checked only when it changes, so an old path does not block other edits.
function templateFolder(value: string | undefined, current: unknown) {
  const folder = (value ?? "").trim();
  if (!folder || folder === String(current ?? "")) return folder || null;
  if (folder.includes("{")) throw new Error("Papka yolunda dəyişən ({...}) ola bilməz — serverdə yaradılmış papkanı seçin.");
  if (folderStore && !folderStore.isDir(folder)) throw new Error(`Papka serverdə tapılmadı: ${folder}`);
  return folder;
}

// Writes an uploaded document under `baseName` into the folder the template gives (a folder the admin made on the server), or — where no
// folder is set or can be written — into the FILES bucket. The file it replaces is removed only after the new one is safely written.
async function storeDocumentFile(input: { baseName: string; fileName: string; contentType: string; data: Uint8Array; folderRule: string; oldPath: string | null; oldKey: string | null; missingRuleNote: string }) {
  if (BLOCKED_DOCUMENT_EXTENSIONS.test(input.fileName)) throw new Error("Bu fayl növünə icazə verilmir.");
  const extMatch = input.fileName.match(/\.[A-Za-z0-9]{1,10}$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : "";
  const dir = input.folderRule.trim();
  let path: string | null = null;
  let key: string | null = null;
  let name: string;
  let note = "";
  if (folderStore && dir) {
    // The app never creates folders: a folder removed or renamed on the server stops the upload instead of landing the file elsewhere.
    if (!folderStore.isDir(dir)) throw new Error(`Şablondakı papka serverdə tapılmadı: ${dir} — adminə müraciət edin.`);
    path = await folderStore.saveUnique(dir, input.baseName, ext, input.data, input.oldPath);
    name = folderStore.baseName(path);
  } else {
    if (!env.FILES) throw new Error("Fayl saxlama aktiv deyil.");
    name = `${input.baseName}${ext}`;
    key = `${crypto.randomUUID()}-${name.replace(/[^\p{L}\p{N}._-]+/gu, "_")}`;
    await env.FILES.put(key, input.data, { httpMetadata: { contentType: input.contentType || "application/octet-stream" }, customMetadata: { originalName: name } });
    note = !folderStore ? "Sənəd sistemdə saxlanıldı (papkaya yazmaq yalnız öz serverdə işləyir)." : input.missingRuleNote;
  }
  if (input.oldPath && input.oldPath !== path && folderStore) await folderStore.remove(input.oldPath);
  if (input.oldKey && env.FILES) await env.FILES.delete(input.oldKey);
  // The saved name without its extension (with any " (2)" it got) — the name the record keeps for its other stage.
  const savedBase = ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  return { path, key, name, savedBase, note };
}

async function loadDocumentFile(path: unknown, key: unknown, name: unknown, type: unknown) {
  const file = { name: String(name || "sened"), type: String(type || "application/octet-stream") };
  if (path) {
    const data = folderStore ? await folderStore.read(String(path)) : null;
    return data ? { ...file, data } : null;
  }
  if (key && env.FILES) {
    const object = await env.FILES.get(String(key));
    return object ? { ...file, data: new Uint8Array(await new Response(object.body).arrayBuffer()) } : null;
  }
  return null;
}

export async function saveOutgoingFile(user: SessionUser, input: { id: number; kind: "draft" | "final"; fileName: string; contentType: string; data: Uint8Array }) {
  await ensureSchema();
  const record = await outgoingRecord(user, input.id);
  if (!record.company_id) throw new Error("Əvvəlcə sənədin firmasını seçin (Redaktə et).");
  const kind = input.kind;
  const access = await outgoingAccess(user);
  if (!access.admin) {
    const { registrarHere, may } = outgoingRights(access, user, record);
    if (!registrarHere) throw new Error("FORBIDDEN");
    // Əlavə et uploads into an empty slot; replacing a file and the ready (signed) document need Dəyişiklik et.
    if (!may.edit && !(may.add && kind === "draft" && !hasOutgoingFile(record, "draft"))) throw new Error("FORBIDDEN");
  }
  const values = documentValues(record);
  const template = record.document_type
    ? await findTemplate(record.company_id, "outgoing", record.document_type)
    : null;
  // The name is worked out once, on the first upload, and reused for the signed copy — so the Word file and the signed file always match.
  const baseName = String(record.file_base_name || "") || tidyName(fillPattern(String(template?.file_name_pattern || DEFAULT_FILE_NAME_PATTERN), values)) || `Sənəd-${values.ÇıxışNo}`;
  const saved = await storeDocumentFile({
    baseName, fileName: input.fileName, contentType: input.contentType, data: input.data,
    folderRule: String(template?.[kind === "draft" ? "draft_folder_path" : "final_folder_path"] || ""),
    oldPath: record[`${kind}_path`] ? String(record[`${kind}_path`]) : null,
    oldKey: record[`${kind}_key`] ? String(record[`${kind}_key`]) : null,
    missingRuleNote: "Şablonda papka göstərilməyib — sənəd sistemdə saxlanıldı.",
  });
  // Daxil olma No of the signed copy: Çıxan sənədlər' own sequence per firm, separate from Daxil olan sənədlər. Only a document whose
  // signed copy comes back gets one — for a letter the file is just a copy of what we sent, and nothing "came in".
  const own = record.signed_copy_returns;
  const comesBack = own !== null && own !== undefined ? Boolean(Number(own)) : Boolean(await templateReturnsSignedCopy(record.company_id, record.document_type));
  const registersReturn = kind === "final" && comesBack;
  const incomingNo = registersReturn && !record.incoming_no ? await nextOutgoingNumber("incoming_no", Number(record.company_id)) : record.incoming_no;
  const incomingDate = registersReturn && !record.incoming_date ? bakuDateIso() : record.incoming_date;
  await db().prepare(`UPDATE outgoing_documents SET file_base_name = ?, ${kind}_path = ?, ${kind}_key = ?, ${kind}_name = ?, ${kind}_size = ?, ${kind}_type = ?, incoming_no = ?, incoming_date = ? WHERE id = ?`)
    .bind(record.file_base_name || saved.savedBase, saved.path, saved.key, saved.name, input.data.byteLength, input.contentType || "application/octet-stream", incomingNo ?? null, incomingDate ?? null, input.id).run();
  return { name: saved.name, path: saved.path, note: saved.note };
}

export async function readOutgoingFile(user: SessionUser, id: number, kind: "draft" | "final") {
  await ensureSchema();
  const record = await db().prepare("SELECT * FROM outgoing_documents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!record) throw new Error("Sənəd tapılmadı.");
  if (!outgoingRights(await outgoingAccess(user), user, record).visible) throw new Error("FORBIDDEN");
  return loadDocumentFile(record[`${kind}_path`], record[`${kind}_key`], record[`${kind}_name`], record[`${kind}_type`]);
}

// ---------- Daxil olan sənədlər ----------

// Daxil olan sənədlər has its own Daxil olma No sequence per firm, independent of Çıxan sənədlər.
async function nextIncomingNumber(companyId: number) {
  const row = await db().prepare("SELECT MAX(CAST(incoming_no AS INTEGER)) AS maxNo FROM incoming_documents WHERE company_id = ?").bind(companyId).first<{ maxNo: number | null }>();
  return String((row?.maxNo || 0) + 1).padStart(6, "0");
}

export const DEFAULT_INCOMING_NAME = "{DaxilOlmaNo}_{Təşkilat}_{Tarix}";

// Workflow (agreed with the admin): Ümumi şöbə — whoever may open Daxil olan sənədlər — registers the document and either marks it
// "Məlumat üçün", sends it straight to one or more departments, or passes it to the director (the head of the top of the firm's
// structure), who picks the department(s). Each department's head gets a task and hands the work on inside it (Həvalə et).
async function incomingScope(user: SessionUser) {
  return outgoingCompanyScope(user);
}

async function incomingRecord(user: SessionUser, id: number) {
  const record = await db().prepare("SELECT i.*, c.name AS company_name FROM incoming_documents i LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = ?").bind(id).first<Record<string, unknown>>();
  if (!record) throw new Error("Sənəd tapılmadı.");
  const scope = await incomingScope(user);
  if (scope && !scope.includes(Number(record.company_id))) throw new Error("FORBIDDEN");
  return record;
}

type IncomingAssignment = { id: number; incoming_id: number; department: string; head_employee_id: number; head_name: string | null; task_id: number | null; task_status: string | null };

async function incomingAssignments(incomingId?: number) {
  const rows = (await db().prepare(`SELECT a.*, e.name AS head_name, t.status AS task_status FROM incoming_assignments a
    LEFT JOIN employees e ON e.id = a.head_employee_id LEFT JOIN tasks t ON t.id = a.task_id
    ${incomingId ? "WHERE a.incoming_id = ?" : ""} ORDER BY a.id`).bind(...(incomingId ? [incomingId] : [])).all<IncomingAssignment>()).results;
  return rows;
}

function incomingStatus(row: Record<string, unknown>, assignments: IncomingAssignment[]) {
  if (row.info_only) return "Məlumat üçün";
  const started = assignments.filter((a) => a.task_status);
  if (Number(row.flow) === 2 && !started.length) return row.director_seen_at ? "Rəhbər tanış olub" : "Rəhbərin baxışında";
  const live = assignments.filter((a) => a.task_status);
  if (live.length) {
    const done = live.filter((a) => a.task_status === "Təsdiqlənib").length;
    if (done === live.length) return "İcra olundu";
    return live.length > 1 ? `İcradadır (${done}/${live.length} şöbə)` : "İcradadır";
  }
  return row.director_pending ? "Rəhbərdə" : "Qeydə alındı";
}

// Once any department has started on its task the routing is fixed; before that it can still be changed (tasks are re-created).
async function clearUnstartedAssignments(incomingId: number, actorName?: string) {
  const assignments = await incomingAssignments(incomingId);
  if (assignments.some((a) => a.task_status && a.task_status !== "Yeni")) throw new Error("Şöbə(lər) icraya başlayıb — sənədin yönləndirilməsini dəyişmək olmaz.");
  for (const a of assignments) if (a.task_id && a.task_status) await deleteTask(a.task_id, actorName);
  await db().prepare("DELETE FROM incoming_assignments WHERE incoming_id = ?").bind(incomingId).run();
}

function incomingValues(record: Record<string, unknown>) {
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  const date = text(record.incoming_date) || bakuDateIso();
  return {
    DaxilOlmaNo: text(record.incoming_no),
    SənədNo: text(record.sender_doc_no),
    SənədTipi: text(record.document_type),
    Təşkilat: text(record.sender_name),
    VÖEN: text(record.sender_voen),
    Firma: text(record.company_name),
    Şöbə: "",
    ÇıxışNo: "",
    Tarix: date.slice(0, 10),
    İl: date.slice(0, 4),
    Ay: date.slice(5, 7),
  };
}

// Who may do what with incoming documents (agreed flow, Versiya 2.59):
// - registrars (Ümumi şöbə: whoever holds the "Daxil olan sənədlər" permission) register documents of their firms, tag the related
//   departments and may correct or delete them while nothing has happened on them yet;
// - the firm's director sees every document of the firm, acknowledges it ("Tanış oldum") and gives tasks by dərkənar;
// - members of a related department (and of a department a request on the document went to) see it read-only and may raise a
//   request from it. The admin sees and may do everything.
// Since Versiya 2.77 (commercial secrecy) only the HEADS of the related departments (and of a request's department) see it, plus
// the people who got a task or a request on it (and those a head handed the task on to); heads of the informed departments only
// see it. Other staff of those departments no longer do.
// Since Versiya 2.62 the registrar's work is split into rights (may): Baxış shows the firm's documents, Əlavə et registers new
// ones (and uploads a file where none is yet), Dəyişiklik et corrects them and replaces files, Sil deletes them.
// Since Versiya 2.99 these rights are given per firm, and in a firm they may be narrowed to some document types (templates):
// such a registrar sees, registers and handles only documents of those types, and corrects or deletes only the ones they registered.
type IncomingAccess = { admin: boolean; rights: FirmAccess; group: "incoming" | "outgoing"; registrarFirms: number[] | null; structure: Awaited<ReturnType<typeof companyDepartments>> };
async function registrarAccess(user: SessionUser, section: "documents.incoming" | "documents.outgoing"): Promise<IncomingAccess> {
  const rights = await firmAccess(user, section);
  return { admin: rights.admin, rights, group: section === "documents.incoming" ? "incoming" : "outgoing", registrarFirms: rights.firms("view"), structure: await companyDepartments() };
}
function registrarRights(access: IncomingAccess, user: SessionUser, row: Record<string, unknown>) {
  if (access.admin) return { here: true, add: true, edit: true, delete: true };
  const firm = access.rights.firm(Number(row.company_id));
  const r = rightsForType(firm, row.document_type);
  const own = !firm.types || Number(row.created_by) === user.id;
  return { here: r.view, add: r.add && own, edit: r.edit && own, delete: r.delete && own };
}
// Where this user registers documents: per firm, every type (types null) or only the names of the listed templates.
async function registerTargets(access: IncomingAccess) {
  const firms = access.rights.firms("add");
  const ids = firms ?? (await db().prepare("SELECT id FROM companies WHERE active = 1").all<{ id: number }>()).results.map((c) => c.id);
  const templates = (await db().prepare("SELECT company_id, name FROM document_templates WHERE template_group = ?").bind(access.group).all<{ company_id: number; name: string }>()).results;
  return ids.map((companyId) => {
    const types = access.rights.firm(companyId).types;
    return { companyId, types: types ? templates.filter((t) => Number(t.company_id) === companyId && types.has(typeKey(t.name))).map((t) => t.name) : null };
  });
}
function requireRegisterType(access: IncomingAccess, companyId: number, documentType: unknown, action: "add" | "edit" = "add") {
  if (access.admin) return;
  const firm = access.rights.firm(companyId);
  if (!firm[action]) throw new Error("FORBIDDEN");
  const type = String(documentType || "").trim();
  if (firm.types && !firm.types.has(typeKey(type))) throw new Error(type ? `“${type}” növlü sənədlər üzrə bu firmada icazəniz yoxdur.` : "Sənədin tipini seçin.");
}
async function incomingAccess(user: SessionUser): Promise<IncomingAccess> {
  return registrarAccess(user, "documents.incoming");
}
const parseDepartments = (raw: unknown): string[] => { try { const list = JSON.parse(String(raw || "[]")); return Array.isArray(list) ? list.map(String) : []; } catch { return []; } };
function incomingRights(access: IncomingAccess, user: SessionUser, row: Record<string, unknown>, assignments: IncomingAssignment[], requests: IncomingRequestLink[], delegates: number[]) {
  const companyId = Number(row.company_id);
  const may = registrarRights(access, user, row);
  const registrarHere = may.here;
  const director = access.admin || Boolean(user.employeeId && access.structure.directorsOf(companyId).has(user.employeeId));
  const me = user.employeeId;
  const heads = new Set(access.structure.headedBy(companyId, me));
  const head = parseDepartments(row.related_departments).some((d) => heads.has(d)) || requests.some((r) => heads.has(r.to_department));
  const involved = Boolean(me && (assignments.some((a) => a.head_employee_id === me) || delegates.includes(me) || requests.some((r) => r.assignee_employee_id === me)))
    || requests.some((r) => r.from_user_id === user.id);
  const informed = parseDepartments(row.informed_departments).some((d) => heads.has(d));
  // member: may raise a request from the document (the informed heads only look at it).
  const member = head || involved;
  return { registrarHere, may, director, member, visible: registrarHere || director || member || informed };
}

// Employees a department head handed the document's task on to (Həvalə et), per incoming document.
async function incomingDelegates(incomingId?: number) {
  const rows = (await db().prepare(`SELECT a.incoming_id, tci.delegated_employee_id AS employee_id FROM incoming_assignments a
    JOIN task_checklist_items tci ON tci.task_id = a.task_id WHERE tci.delegated_employee_id IS NOT NULL${incomingId ? " AND a.incoming_id = ?" : ""}`)
    .bind(...(incomingId ? [incomingId] : [])).all<{ incoming_id: number; employee_id: number }>()).results;
  const byDocument = new Map<number, number[]>();
  for (const r of rows) byDocument.set(r.incoming_id, [...(byDocument.get(r.incoming_id) ?? []), Number(r.employee_id)]);
  return byDocument;
}
type IncomingRequestLink = { id: number; incoming_id: number; from_department: string | null; to_department: string; status: string; title: string; assignee_employee_id: number | null; from_user_id: number | null };
async function incomingRequests(incomingId?: number): Promise<IncomingRequestLink[]> {
  await ensureRequestSchema();
  return (await db().prepare(`SELECT id, incoming_id, from_department, to_department, status, title, assignee_employee_id, from_user_id FROM work_requests WHERE incoming_id IS NOT NULL${incomingId ? " AND incoming_id = ?" : ""} ORDER BY id`)
    .bind(...(incomingId ? [incomingId] : [])).all<IncomingRequestLink>()).results;
}

// ---------- Təsdiq (Versiya 2.61) ----------
// Two-level approval of incoming and outgoing documents: each related department's head approves, then the firm's director
// gives the final approval (and may do so without waiting). The director may send the document back with a note: the
// departments then approve again. Every step is a row of document_approvals, so the history stays. The first department
// approval locks the registrar's editing; a return does not unlock it. Documents registered before 2.61 need no approval.
export type ApprovalKind = "incoming" | "outgoing";
type ApprovalRow = { id: number; doc_kind: string; doc_id: number; level: string; department: string | null; action: string; note: string | null; user_name: string; created_at: string };

async function approvalRows(kind: ApprovalKind, docId?: number): Promise<ApprovalRow[]> {
  return (await db().prepare(`SELECT * FROM document_approvals WHERE doc_kind = ?${docId ? " AND doc_id = ?" : ""} ORDER BY id`)
    .bind(...(docId ? [kind, docId] : [kind])).all<ApprovalRow>()).results;
}

function approvalState(kind: ApprovalKind, row: Record<string, unknown>, rows: ApprovalRow[], access: IncomingAccess, user: SessionUser, extra: { departments: string[]; openTaskDepartments?: Set<string> }) {
  const required = kind === "incoming" ? Number(row.flow) === 2 : Number(row.approval_flow) === 1;
  const companyId = Number(row.company_id);
  const lastReturn = [...rows].reverse().find((r) => r.level === "director" && r.action === "return") || null;
  const cycle = lastReturn ? rows.filter((r) => r.id > lastReturn.id) : rows;
  const final = rows.find((r) => r.level === "director" && r.action === "approve") || null;
  const locked = rows.some((r) => r.action === "approve");
  // When the departments may approve: an incoming document after the director has looked at it (or given tasks), an outgoing
  // one once its ready document (the signed copy, or the copy of a document that is not returned) is in.
  const ready = kind === "incoming" ? Boolean(row.director_seen_at || row.assigned_at) : Boolean(row.final_name || row.final_path || row.final_key);
  const director = access.admin || Boolean(user.employeeId && access.structure.directorsOf(companyId).has(user.employeeId));
  const heads = new Set(access.structure.headedBy(companyId, user.employeeId));
  const departments = extra.departments.map((name) => {
    const done = cycle.find((r) => r.level === "department" && r.department === name && r.action === "approve") || null;
    const openTasks = Boolean(extra.openTaskDepartments?.has(name));
    return {
      name, approved: done ? { by: done.user_name, at: done.created_at } : null, openTasks,
      canApprove: required && ready && !final && !done && !openTasks && (access.admin || heads.has(name)),
    };
  });
  const allApproved = departments.length > 0 && departments.every((d) => d.approved);
  const label = !required ? "Tələb olunmur" : final ? "Təsdiqləndi" : !ready ? (kind === "incoming" ? "Rəhbərin baxışı gözlənilir" : "Hazır sənəd gözlənilir")
    : allApproved ? "Rəhbərin təsdiqini gözləyir" : `Şöbələr: ${departments.filter((d) => d.approved).length}/${departments.length}`;
  return {
    required, ready, label, locked, departments,
    final: final ? { by: final.user_name, at: final.created_at, note: final.note } : null,
    returned: lastReturn && !final ? { by: lastReturn.user_name, at: lastReturn.created_at, note: lastReturn.note } : null,
    canFinal: required && ready && !final && director,
    canReturn: required && ready && !final && director && cycle.some((r) => r.level === "department"),
    history: rows.map((r) => ({ level: r.level, department: r.department, action: r.action, note: r.note, by: r.user_name, at: r.created_at })),
  };
}

export async function recordApproval(user: SessionUser, input: { kind: ApprovalKind; id: number; action: "approve" | "return"; level: "department" | "director"; department?: string; note?: string }) {
  await ensureSchema();
  const kind = input.kind === "outgoing" ? "outgoing" : "incoming";
  const row = await db().prepare(`SELECT * FROM ${kind === "incoming" ? "incoming_documents" : "outgoing_documents"} WHERE id = ?`).bind(input.id).first<Record<string, unknown>>();
  if (!row) throw new Error("Sənəd tapılmadı.");
  const access = kind === "incoming" ? await incomingAccess(user) : await outgoingAccess(user);
  const state = await approvalStateFor(kind, row, access, user);
  const note = input.note?.trim() || null;
  if (input.level === "department") {
    const dept = state.departments.find((d) => d.name === input.department);
    if (!dept) throw new Error("Bu şöbə sənədin aidiyyatı şöbələri arasında yoxdur.");
    if (dept.openTasks) throw new Error(`“${dept.name}” şöbəsində bu sənəd üzrə tapşırıq hələ bağlanmayıb.`);
    if (!dept.canApprove) throw new Error(dept.approved ? "Bu şöbə artıq təsdiqləyib." : !state.ready ? `Təsdiq hələ mümkün deyil: ${state.label.toLocaleLowerCase("az")}.` : "Bu şöbə üzrə təsdiqi yalnız şöbənin rəisi verə bilər.");
  } else if (input.action === "approve" ? !state.canFinal : !state.canReturn) {
    throw new Error(input.action === "return" && state.canFinal ? "Geri qaytarmaq üçün ən azı bir şöbə təsdiqləmiş olmalıdır." : "Son təsdiqi yalnız firmanın rəhbəri verə bilər.");
  }
  if (input.action === "return" && !note) throw new Error("Geri qaytarmanın səbəbini yazın.");
  await db().prepare("INSERT INTO document_approvals (doc_kind, doc_id, level, department, action, note, user_id, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(kind, input.id, input.level, input.level === "department" ? input.department : null, input.action, note, user.id, user.name, new Date().toISOString()).run();
}

async function approvalStateFor(kind: ApprovalKind, row: Record<string, unknown>, access: IncomingAccess, user: SessionUser) {
  const rows = await approvalRows(kind, Number(row.id));
  if (kind === "outgoing") return approvalState(kind, row, rows, access, user, { departments: outgoingDepartments(row) });
  const assignments = await incomingAssignments(Number(row.id));
  return approvalState(kind, row, rows, access, user, incomingApprovalScope(row, assignments));
}

// An incoming document is approved by its related departments and by any department that got a task on it; a department
// with an unfinished task on it cannot approve yet.
function incomingApprovalScope(row: Record<string, unknown>, assignments: IncomingAssignment[]) {
  const departments = [...new Set([...parseDepartments(row.related_departments), ...assignments.map((a) => a.department)])].filter((d) => d && d !== "—");
  const openTaskDepartments = new Set(assignments.filter((a) => a.task_status && a.task_status !== "Təsdiqlənib").map((a) => a.department));
  return { departments, openTaskDepartments };
}

export async function getIncomingDocuments(user: SessionUser) {
  await ensureSchema();
  const access = await incomingAccess(user);
  const assignments = await incomingAssignments();
  const byDocument = new Map<number, IncomingAssignment[]>();
  for (const a of assignments) byDocument.set(a.incoming_id, [...(byDocument.get(a.incoming_id) ?? []), a]);
  const approvals = await approvalRows("incoming");
  const approvalsOf = new Map<number, ApprovalRow[]>();
  for (const r of approvals) approvalsOf.set(r.doc_id, [...(approvalsOf.get(r.doc_id) ?? []), r]);
  const requests = await incomingRequests();
  const requestsOf = new Map<number, typeof requests>();
  for (const r of requests) requestsOf.set(r.incoming_id, [...(requestsOf.get(r.incoming_id) ?? []), r]);
  const delegatesOf = await incomingDelegates();
  // The sender's phone is read from their customer card (Versiya 2.77).
  const items = (await db().prepare(`SELECT i.*, c.name AS company_name, (SELECT phone FROM customers cu WHERE cu.voen = i.sender_voen AND trim(COALESCE(i.sender_voen, '')) != '' LIMIT 1) AS sender_phone
    FROM incoming_documents i LEFT JOIN companies c ON c.id = i.company_id ORDER BY i.id DESC`)
    .all<Record<string, unknown>>()).results.flatMap((row) => {
    const own = byDocument.get(Number(row.id)) ?? [];
    const linked = requestsOf.get(Number(row.id)) ?? [];
    const rights = incomingRights(access, user, row, own, linked, delegatesOf.get(Number(row.id)) ?? []);
    if (!rights.visible) return [];
    const locked = own.some((a) => a.task_status && a.task_status !== "Yeni");
    const approval = approvalState("incoming", row, approvalsOf.get(Number(row.id)) ?? [], access, user, incomingApprovalScope(row, own));
    const editable = access.admin || !approval.locked;
    return [{
      ...row, status: approval.final ? "Bağlandı" : incomingStatus(row, own), related_departments: parseDepartments(row.related_departments), informed_departments: parseDepartments(row.informed_departments), approval,
      assignments: own.map((a) => ({ department: a.department, head_name: a.head_name, task_status: a.task_status })),
      requests: linked.map((r) => ({ id: r.id, from_department: r.from_department, to_department: r.to_department, status: r.status })),
      locked,
      file_missing: Boolean(row.file_path && folderStore && !folderStore.exists(String(row.file_path))),
      can: {
        edit: rights.may.edit && editable,
        remove: access.admin || (rights.may.delete && editable && !own.length && !linked.length),
        upload: rights.registrarHere && (access.admin || !approval.final) && (rights.may.edit || (rights.may.add && !row.file_name && !row.file_path && !row.file_key)),
        direct: rights.director && !locked && !approval.final && incomingStatus(row, own) !== "İcra olundu",
        review: rights.director && !row.director_seen_at && !own.length,
        request: rights.member || rights.director,
      },
    }];
  });
  // Firms whose departments the page needs: those of the visible documents, plus where this user registers or directs.
  const activeFirms = (await db().prepare("SELECT id FROM companies WHERE active = 1").all<{ id: number }>()).results.map((c) => c.id);
  const directorOf = activeFirms.filter((companyId) => access.admin || Boolean(user.employeeId && access.structure.directorsOf(companyId).has(user.employeeId)));
  const firms = new Set<number>([...items.map((i: Record<string, unknown>) => Number(i.company_id)), ...directorOf, ...(access.registrarFirms ?? (access.admin ? activeFirms : []))]);
  const departments = [...firms].flatMap((companyId) => access.structure.departmentsOf(companyId).map((d) => ({ company_id: companyId, ...d, members: access.structure.membersOf(companyId, d.name).map((m) => ({ id: m.id, name: m.name, position_title: m.position_title })) })));
  // Document types from Şablonlar (each firm's “Daxil olan sənəd” templates), with where a scan of that type is filed.
  const allTypes = (await db().prepare("SELECT company_id, name, departments, incoming_folder_path, incoming_name_pattern FROM document_templates WHERE template_group = 'incoming' ORDER BY name").all<{ company_id: number; name: string; departments: string | null; incoming_folder_path: string | null; incoming_name_pattern: string | null }>()).results;
  const types = allTypes.filter((t) => firms.has(Number(t.company_id)));
  // Versiya 2.99: where (and which types) this user registers — the page offers only those firms and types.
  const registerIn = await registerTargets(access);
  return { items, departments, directorOf, types, canRegister: registerIn.length > 0, registerIn };
}

// The director's badge: documents waiting for their look (for the admin: in every firm).
export async function countIncomingForDirector(user: SessionUser) {
  await ensureSchema();
  const rows = (await db().prepare(`SELECT company_id FROM incoming_documents i WHERE (i.director_pending = 1 AND i.info_only = 0)
    OR (i.flow = 2 AND i.director_seen_at IS NULL AND NOT EXISTS (SELECT 1 FROM incoming_assignments a WHERE a.incoming_id = i.id))`).all<{ company_id: number }>()).results;
  if (user.role === "admin") return rows.length;
  if (!user.employeeId) return 0;
  const structure = await companyDepartments();
  return rows.filter((row) => structure.directorsOf(row.company_id).has(user.employeeId!)).length;
}

type IncomingInput = { informedDepartments?: string[]; relatedDepartments?: string[]; companyId?: number; incomingDate?: string; incomingNo?: string; senderVoen?: string; senderName?: string; senderDocNo?: string; senderDocDate?: string; documentType?: string; receiveMethod?: string; summary?: string; pages?: string; copies?: string; note?: string };

// With a VÖEN the sender must be a card in the customer list, and its name comes from there.
async function senderFromVoen(voen: string | undefined, name: string | undefined) {
  const value = voen?.trim();
  if (!value) {
    if (!name?.trim()) throw new Error("Göndərən təşkilatı yazın.");
    return { voen: null, name: name.trim() };
  }
  const customer = await db().prepare("SELECT name FROM customers WHERE voen = ?").bind(value).first<{ name: string }>();
  if (!customer) throw new Error("Bu VÖEN müştəri siyahısında yoxdur — əvvəlcə müştəri kartını yaradın.");
  return { voen: value, name: customer.name };
}

export async function findCustomerByVoen(voen: string) {
  await ensureSchema();
  const value = voen.trim();
  if (!value) return null;
  return db().prepare("SELECT id, voen, name, entity_type, phone FROM customers WHERE voen = ?").bind(value).first<{ id: number; voen: string; name: string; entity_type: string | null; phone: string | null }>();
}

// The related departments must be departments of the firm's structure; at least one is required.
async function relatedDepartments(companyId: number, raw: unknown) {
  const chosen = [...new Set((Array.isArray(raw) ? raw : []).map((d) => String(d).trim()).filter(Boolean))];
  if (!chosen.length) throw new Error("Aidiyyatı şöbəni (və ya şöbələri) seçin.");
  const known = new Set((await companyDepartments()).departmentsOf(companyId).map((d) => d.name));
  const unknown = chosen.find((d) => !known.has(d));
  if (unknown) throw new Error(`"${unknown}" bu firmanın strukturunda yoxdur.`);
  return JSON.stringify(chosen);
}

// Versiya 2.77: the related departments of a document whose type's template names them come from the template (the registrar
// cannot pick wrong ones); a type without them keeps the registrar's choice.
async function documentDepartments(companyId: number, group: "outgoing" | "incoming", documentType: unknown, requested: unknown) {
  const template = await findTemplate<{ departments: string | null }>(companyId, group, documentType);
  const fixed = parseDepartments(template?.departments);
  if (!fixed.length) return relatedDepartments(companyId, requested);
  try { return await relatedDepartments(companyId, fixed); }
  catch (error) { throw new Error(`Şablonun aidiyyatı şöbəsi: ${error instanceof Error ? error.message : ""} Sənədlər → Şablonlar bölməsində düzəldin.`); }
}

// "Məlumatlandırılan şöbə(lər)": optional departments whose heads only see the document (not those already related to it).
async function informedDepartments(companyId: number, raw: unknown, related: string[]) {
  const chosen = [...new Set((Array.isArray(raw) ? raw : []).map((d) => String(d).trim()).filter(Boolean))].filter((d) => !related.includes(d));
  if (!chosen.length) return null;
  const known = new Set((await companyDepartments()).departmentsOf(companyId).map((d) => d.name));
  const unknown = chosen.find((d) => !known.has(d));
  if (unknown) throw new Error(`"${unknown}" bu firmanın strukturunda yoxdur.`);
  return JSON.stringify(chosen);
}

// The phone of a document's customer comes from their card (Versiya 2.77).
async function customerPhoneByVoen(voen: unknown) {
  const value = String(voen || "").trim();
  if (!value) return null;
  return (await db().prepare("SELECT phone FROM customers WHERE voen = ? LIMIT 1").bind(value).first<{ phone: string | null }>())?.phone || null;
}

async function incomingForAction(user: SessionUser, id: number) {
  const record = await db().prepare("SELECT i.*, c.name AS company_name FROM incoming_documents i LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = ?").bind(id).first<Record<string, unknown>>();
  if (!record) throw new Error("Sənəd tapılmadı.");
  const access = await incomingAccess(user);
  const assignments = await incomingAssignments(id);
  const requests = await incomingRequests(id);
  const delegates = (await incomingDelegates(id)).get(id) ?? [];
  return { record, access, assignments, requests, rights: incomingRights(access, user, record, assignments, requests, delegates) };
}

export async function createIncomingDocument(user: SessionUser, input: IncomingInput) {
  await ensureSchema();
  const companyId = Number(input.companyId);
  if (!companyId) throw new Error("Firma seçilməyib.");
  const scope = await incomingScope(user);
  if (scope && !scope.includes(companyId)) throw new Error("FORBIDDEN");
  requireRegisterType(await incomingAccess(user), companyId, input.documentType);
  const sender = await senderFromVoen(input.senderVoen, input.senderName);
  const related = await documentDepartments(companyId, "incoming", input.documentType, input.relatedDepartments);
  const informed = await informedDepartments(companyId, input.informedDepartments, parseDepartments(related));
  const incomingNo = await nextIncomingNumber(companyId);
  const result = await db().prepare(`INSERT INTO incoming_documents
    (company_id, incoming_no, incoming_date, sender_voen, sender_name, sender_doc_no, sender_doc_date, document_type, receive_method, summary, pages, copies, note, created_by, created_by_name, created_at, related_departments, informed_departments, flow)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)`)
    .bind(companyId, incomingNo, input.incomingDate || bakuDateIso(), sender.voen, sender.name, input.senderDocNo?.trim() || null, input.senderDocDate || null,
      input.documentType?.trim() || null, input.receiveMethod || null, input.summary?.trim() || null, input.pages?.trim() || null, input.copies || null, input.note?.trim() || null, user.id, user.name, new Date().toISOString(), related, informed).run();
  return { id: Number(result.meta.last_row_id), incomingNo };
}

// The registrar corrects the registration (the Daxil olma No stays the admin's: it is a running number).
export async function updateIncomingDocument(user: SessionUser, input: IncomingInput & { id: number }) {
  await ensureSchema();
  const { record: current, access, rights } = await incomingForAction(user, input.id);
  if (!rights.may.edit) throw new Error("FORBIDDEN");
  if (!access.admin && (await approvalStateFor("incoming", current, access, user)).locked) throw new Error("Sənəd artıq təsdiqlənməyə başlayıb — onu yalnız admin dəyişə bilər.");
  if (input.documentType !== undefined && String(input.documentType || "").trim() !== String(current.document_type || "").trim()) requireRegisterType(access, Number(current.company_id), input.documentType, "edit");
  const pick = (value: string | undefined, fallback: unknown) => (value === undefined ? fallback : value.trim() || null);
  const sender = input.senderVoen !== undefined || input.senderName !== undefined
    ? await senderFromVoen(input.senderVoen ?? String(current.sender_voen || ""), input.senderName ?? String(current.sender_name || ""))
    : { voen: current.sender_voen, name: current.sender_name };
  const typeChanged = input.documentType !== undefined && String(input.documentType || "").trim() !== String(current.document_type || "").trim();
  const related = input.relatedDepartments !== undefined || typeChanged
    ? await documentDepartments(Number(current.company_id), "incoming", input.documentType ?? current.document_type, input.relatedDepartments) : current.related_departments;
  const informed = input.informedDepartments !== undefined
    ? await informedDepartments(Number(current.company_id), input.informedDepartments, parseDepartments(related)) : current.informed_departments;
  const incomingNo = access.admin ? pick(input.incomingNo, current.incoming_no) || current.incoming_no : current.incoming_no;
  await db().prepare(`UPDATE incoming_documents SET incoming_no = ?, incoming_date = ?, sender_voen = ?, sender_name = ?, sender_doc_no = ?, sender_doc_date = ?, document_type = ?, receive_method = ?, summary = ?, pages = ?, copies = ?, note = ?, related_departments = ?, informed_departments = ? WHERE id = ?`)
    .bind(incomingNo, pick(input.incomingDate, current.incoming_date), sender.voen, sender.name,
      pick(input.senderDocNo, current.sender_doc_no), pick(input.senderDocDate, current.sender_doc_date), pick(input.documentType, current.document_type), pick(input.receiveMethod, current.receive_method),
      pick(input.summary, current.summary), pick(input.pages, current.pages), pick(input.copies, current.copies), pick(input.note, current.note), related, informed ?? null, input.id).run();
}

// The registrar deletes only a document nothing has happened on; the admin also one whose tasks have not started.
export async function deleteIncomingDocument(user: SessionUser, id: number) {
  await ensureSchema();
  const { record: current, access, assignments, requests, rights } = await incomingForAction(user, id);
  if (!rights.may.delete) throw new Error("FORBIDDEN");
  if (!access.admin && (await approvalStateFor("incoming", current, access, user)).locked) throw new Error("Sənəd artıq təsdiqlənməyə başlayıb — onu yalnız admin silə bilər.");
  if (!access.admin && !(rights.registrarHere && !assignments.length && !requests.length)) throw new Error("Sənəd üzrə tapşırıq və ya sorğu var — onu yalnız admin silə bilər.");
  // Tasks not started yet go with the document, approved ones stay in the heads' history; one in progress blocks the delete.
  if (assignments.some((a) => a.task_status && !["Yeni", "Təsdiqlənib"].includes(a.task_status))) throw new Error("Sənəd icradadır — əvvəlcə şöbələrin tapşırıqları bağlanmalıdır.");
  if (requests.some((r) => !["Bağlandı", "İmtina edildi"].includes(r.status))) throw new Error("Sənəd üzrə açıq sorğu var — əvvəlcə sorğular bağlanmalıdır.");
  for (const a of assignments) if (a.task_id && a.task_status === "Yeni") await deleteTask(a.task_id, user.name);
  await db().prepare("DELETE FROM incoming_assignments WHERE incoming_id = ?").bind(id).run();
  await db().prepare("UPDATE work_requests SET incoming_id = NULL WHERE incoming_id = ?").bind(id).run();
  await db().prepare("DELETE FROM incoming_documents WHERE id = ?").bind(id).run();
  // Scans in the server folders are the archive and stay; only a copy kept inside the system goes with the record.
  if (current.file_key && env.FILES) await env.FILES.delete(String(current.file_key));
}

// The director has looked at the document and gives no task ("Tanış oldum").
export async function reviewIncomingDocument(user: SessionUser, input: { id: number; note?: string }) {
  await ensureSchema();
  const { rights } = await incomingForAction(user, input.id);
  if (!rights.director) throw new Error("Sənədlə yalnız firmanın rəhbəri tanış ola bilər.");
  await db().prepare("UPDATE incoming_documents SET director_seen_at = ?, director_seen_by = ?, director_pending = 0, resolution = COALESCE(?, resolution) WHERE id = ?")
    .bind(new Date().toISOString(), user.name, input.note?.trim() || null, input.id).run();
}

// The director's dərkənar: a task to the head of each chosen department and/or to chosen employees directly. Until any of
// them has started, the director may change the recipients (the unstarted tasks are re-created).
export async function directIncomingDocument(user: SessionUser, input: { id: number; departments?: string[]; employees?: number[]; dueDate?: string; resolution?: string }) {
  await ensureSchema();
  const { record, rights } = await incomingForAction(user, input.id);
  if (!rights.director) throw new Error("Tapşırığı yalnız firmanın rəhbəri verə bilər.");
  const companyId = Number(record.company_id);
  const structure = await companyDepartments();
  const departments = structure.departmentsOf(companyId);
  const chosen = [...new Set((input.departments ?? []).map((d) => d.trim()).filter(Boolean))];
  const people = [...new Set((input.employees ?? []).map(Number).filter(Boolean))];
  if (!chosen.length && !people.length) throw new Error("Ən azı bir şöbə və ya işçi seçin.");
  if (!input.dueDate) throw new Error("İcra müddətini seçin.");
  const targets: { department: string; head: { id: number; name: string } }[] = chosen.map((name) => {
    const dept = departments.find((d) => d.name === name);
    if (!dept) throw new Error(`"${name}" bu firmanın strukturunda yoxdur.`);
    if (!dept.heads.length) throw new Error(`"${name}" şöbəsinin rəisi təyin edilməyib — ya rəisi təyin edin, ya da tapşırığı birbaşa işçiyə verin.`);
    return { department: name, head: dept.heads[0] };
  });
  for (const id of people) {
    const home = structure.memberOf(companyId, id)[0];
    const person = home ? structure.membersOf(companyId, home).find((m) => m.id === id) : null;
    if (!home || !person) throw new Error("Seçilmiş işçi bu firmanın strukturunda yoxdur.");
    if (!targets.some((t) => t.head.id === id)) targets.push({ department: home, head: { id, name: person.name } });
  }
  await clearUnstartedAssignments(input.id, user.name);
  const now = new Date().toISOString();
  const dueAt = new Date(`${input.dueDate}T18:00:00+04:00`).toISOString();
  const resolution = input.resolution?.trim() || "";
  const title = `Daxil olan sənəd №${record.incoming_no}: ${record.sender_name}${record.summary ? ` — ${record.summary}` : ""}`.slice(0, 200);
  for (const target of targets) {
    const others = targets.filter((t) => t !== target).map((t) => `${t.head.name} (${t.department})`);
    const description = [
      resolution ? `Rəhbərin dərkənarı: ${resolution}` : "Rəhbərin dərkənarı ilə icraya verilib.",
      `Göndərən: ${record.sender_name}${record.sender_doc_no ? `, №${record.sender_doc_no}` : ""}${record.sender_doc_date ? ` (${record.sender_doc_date})` : ""}`,
      record.summary ? `Məzmun: ${record.summary}` : "",
      others.length ? `Tapşırıq həm də bunlara verilib: ${others.join(", ")}.` : "",
      "Sənədin özü: Sənədlər → Daxil olan sənədlər.",
    ].filter(Boolean).join("\n");
    const task = await db().prepare(`INSERT INTO tasks (employee_id, company_id, title, description, due_at, original_due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?)`)
      .bind(target.head.id, companyId, title, description, dueAt, dueAt, now).run();
    await db().prepare("INSERT INTO incoming_assignments (incoming_id, department, head_employee_id, task_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(input.id, target.department, target.head.id, Number(task.meta.last_row_id), now).run();
  }
  await db().prepare("UPDATE incoming_documents SET info_only = 0, director_pending = 0, director_seen_at = COALESCE(director_seen_at, ?), director_seen_by = COALESCE(director_seen_by, ?), due_date = ?, resolution = ?, assigned_by_name = ?, assigned_at = ? WHERE id = ?")
    .bind(now, user.name, input.dueDate, resolution || null, user.name, now, input.id).run();
  return targets;
}

// A related department asks another department for something on this document; the request carries a link back to it.
export async function createIncomingRequest(user: SessionUser, input: { id: number; toDepartment: string; title: string; description?: string; dueDate?: string }) {
  await ensureSchema();
  const { record, rights } = await incomingForAction(user, input.id);
  if (!rights.member && !rights.director) throw new Error("Sorğunu yalnız aidiyyatı şöbənin əməkdaşı və ya rəhbər yarada bilər.");
  const description = [input.description?.trim() || "", `Daxil olan sənəd №${record.incoming_no}: ${record.sender_name}${record.summary ? ` — ${record.summary}` : ""}. Sənədin skanı sorğunun “Daxil olan sənəd” linkindən açılır.`].filter(Boolean).join("\n\n");
  return createRequest(user, { companyId: Number(record.company_id), toDepartment: input.toDepartment, title: input.title, description, desiredDueAt: input.dueDate, incomingId: input.id });
}

export async function saveIncomingFile(user: SessionUser, input: { id: number; fileName: string; contentType: string; data: Uint8Array }) {
  await ensureSchema();
  const record = await incomingRecord(user, input.id);
  const access = await incomingAccess(user);
  if (!access.admin) {
    const { registrarHere, may } = incomingRights(access, user, record, [], [], []);
    if (!registrarHere) throw new Error("FORBIDDEN");
    // Əlavə et uploads the scan of a document that has none yet; replacing it needs Dəyişiklik et.
    if (!may.edit && !(may.add && !record.file_name && !record.file_path && !record.file_key)) throw new Error("FORBIDDEN");
  }
  const values = incomingValues(record);
  // The folder and naming rule come from the template of the document's type (Şablonlar), like for outgoing documents.
  const template = record.document_type
    ? await findTemplate<{ incoming_folder_path: string | null; incoming_name_pattern: string | null }>(record.company_id, "incoming", record.document_type)
    : null;
  const baseName = String(record.file_base_name || "") || tidyName(fillPattern(template?.incoming_name_pattern || DEFAULT_INCOMING_NAME, values)) || `Daxil-olan-${values.DaxilOlmaNo}`;
  const saved = await storeDocumentFile({
    baseName, fileName: input.fileName, contentType: input.contentType, data: input.data, folderRule: template?.incoming_folder_path || "",
    oldPath: record.file_path ? String(record.file_path) : null, oldKey: record.file_key ? String(record.file_key) : null,
    missingRuleNote: template ? "Şablonda daxil olan sənəd papkası göstərilməyib — sənəd sistemdə saxlanıldı." : "Bu sənəd tipi üçün şablon yoxdur — sənəd sistemdə saxlanıldı.",
  });
  await db().prepare("UPDATE incoming_documents SET file_base_name = ?, file_path = ?, file_key = ?, file_name = ?, file_size = ?, file_type = ? WHERE id = ?")
    .bind(record.file_base_name || saved.savedBase, saved.path, saved.key, saved.name, input.data.byteLength, input.contentType || "application/octet-stream", input.id).run();
  return { name: saved.name, path: saved.path, note: saved.note };
}

// A department head the document was sent to may open its scan even without access to Daxil olan sənədlər.
export async function readIncomingFile(user: SessionUser, id: number) {
  await ensureSchema();
  const { record, rights } = await incomingForAction(user, id);
  if (!rights.visible) throw new Error("FORBIDDEN");
  return loadDocumentFile(record.file_path, record.file_key, record.file_name, record.file_type);
}

const FOREIGN_SUPPLIER = "Xarici təchizatçı";

// Where a customer card is in use: outgoing and incoming documents point at it by VÖEN, HR prior jobs by id. A card in use
// cannot be deleted (the list hides its delete button). The HR table only exists once the HR section has been opened.
async function customerUsageSql() {
  const hasHr = await db().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'hr_prior_jobs'").first();
  return {
    outgoing: "(SELECT COUNT(*) FROM outgoing_documents WHERE outgoing_documents.voen = customers.voen)",
    incoming: "(SELECT COUNT(*) FROM incoming_documents WHERE incoming_documents.sender_voen = customers.voen)",
    hr: hasHr ? "(SELECT COUNT(DISTINCT hr_employee_id) FROM hr_prior_jobs WHERE hr_prior_jobs.customer_id = customers.id)" : "0",
  };
}

// A customer's phone is required: digits with an optional leading +, spaces, dashes and brackets, 7–15 digits (foreign numbers too).
function customerPhone(value: string | null | undefined) {
  const phone = value?.trim().replace(/\s+/g, " ");
  if (!phone) throw new Error("Müştərinin telefon nömrəsini daxil edin.");
  if (!/^\+?[\d\s()-]+$/.test(phone)) throw new Error("Telefon nömrəsi yalnız rəqəm, boşluq, \"+\", \"-\" və mötərizədən ibarət ola bilər.");
  const digits = phone.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) throw new Error("Telefon nömrəsi 7–15 rəqəmdən ibarət olmalıdır.");
  return formatPhone(phone);
}

export async function getCustomers() {
  await ensureSchema();
  const usage = await customerUsageSql();
  return (await db().prepare(`SELECT customers.*, ${usage.outgoing} + ${usage.incoming} + ${usage.hr} AS usage_count FROM customers ORDER BY name`).all()).results;
}

// A customer's history (Versiya 2.86): the outgoing and incoming documents with its VÖEN, newest first. Each user gets only the
// documents they may see in Çıxan / Daxil olan sənədlər, so the history keeps the commercial secrecy of those sections.
export async function getCustomerDocuments(user: SessionUser) {
  const outgoing = (await outgoingRows(user)).filter((d) => String(d.voen || "").trim()).map((d) => ({
    kind: "outgoing" as const, id: Number(d.id), voen: String(d.voen).trim(), company_name: d.company_name, no: d.outgoing_no, date: d.outgoing_date || String(d.created_at || "").slice(0, 10),
    document_type: d.document_type, document_number: d.document_number, note: d.note,
    returns_signed_copy: d.returns_signed_copy, return_due_date: d.return_due_date, returned_no: d.incoming_no, returned_date: d.incoming_date,
    draft_name: d.draft_name, final_name: d.final_name, has_draft: hasOutgoingFile(d, "draft"), has_final: hasOutgoingFile(d, "final"),
  }));
  const incoming = ((await getIncomingDocuments(user)).items as unknown as Array<Record<string, unknown>>).filter((d: Record<string, unknown>) => String(d.sender_voen || "").trim()).map((d: Record<string, unknown>) => ({
    kind: "incoming" as const, id: Number(d.id), voen: String(d.sender_voen).trim(), company_name: d.company_name, no: d.incoming_no, date: d.incoming_date || String(d.created_at || "").slice(0, 10),
    document_type: d.document_type, document_number: d.sender_doc_no, document_date: d.sender_doc_date, note: d.summary, status: d.status, file_name: d.file_name,
  }));
  return [...outgoing, ...incoming].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.id - a.id);
}

export async function createCustomer(input: { entityType?: string; country?: string; voen?: string; name: string; legalAddress?: string; legalAddress2?: string; manager?: string; phone?: string }) {
  await ensureSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Müştərinin adını yazın.");
  const entityType = input.entityType?.trim();
  if (!entityType) throw new Error("Statusu seçin.");
  const foreign = entityType === FOREIGN_SUPPLIER;
  const country = foreign ? input.country?.trim() || null : null;
  if (foreign && !country) throw new Error("Xarici təchizatçının ölkəsini seçin.");
  const voen = input.voen?.trim() || null;
  if (!voen && !foreign) throw new Error("VÖEN/FİN daxil edin.");
  const legalAddress = input.legalAddress?.trim();
  if (!legalAddress) throw new Error("Hüquqi ünvanı yazın.");
  const manager = input.manager?.trim();
  if (!manager) throw new Error("Rəhbəri yazın.");
  const phone = customerPhone(input.phone);
  const duplicate = voen ? await db().prepare("SELECT id, name FROM customers WHERE voen = ? AND COALESCE(country, '') = COALESCE(?, '')").bind(voen, country).first<{ id: number; name: string }>() : null;
  if (duplicate) throw new Error(`Bu VÖEN/FİN artıq "${duplicate.name}" müştərisində qeydə alınıb. Təkrar müştəri kartı yaradıla bilməz.`);
  await db().prepare(`INSERT INTO customers
    (entity_type, country, voen, name, legal_address, legal_address2, manager, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(entityType, country, voen, name, legalAddress, input.legalAddress2 || null, manager, phone, new Date().toISOString()).run();
}

export async function updateCustomer(input: { id: number; entityType?: string; country?: string; voen?: string; name?: string; legalAddress?: string; legalAddress2?: string; manager?: string; phone?: string }) {
  await ensureSchema();
  const current = await db().prepare("SELECT * FROM customers WHERE id = ?").bind(input.id).first<Record<string, unknown>>();
  if (!current) throw new Error("Müştəri tapılmadı.");
  const name = input.name?.trim() || (current.name as string);
  if (!name) throw new Error("Müştərinin adını yazın.");
  const entityType = input.entityType === undefined ? (current.entity_type as string | null) : input.entityType.trim();
  if (!entityType) throw new Error("Statusu seçin.");
  const foreign = entityType === FOREIGN_SUPPLIER;
  const country = foreign ? (input.country === undefined ? (current.country as string | null) : input.country.trim() || null) : null;
  if (foreign && !country) throw new Error("Xarici təchizatçının ölkəsini seçin.");
  const voen = input.voen === undefined ? (current.voen as string | null) : (input.voen.trim() || null);
  if (!voen && !foreign) throw new Error("VÖEN/FİN daxil edin.");
  const legalAddress = input.legalAddress === undefined ? (current.legal_address as string | null) : input.legalAddress.trim();
  if (!legalAddress) throw new Error("Hüquqi ünvanı yazın.");
  const manager = input.manager === undefined ? (current.manager as string | null) : input.manager.trim();
  if (!manager) throw new Error("Rəhbəri yazın.");
  const phone = customerPhone(input.phone === undefined ? (current.phone as string | null) : input.phone);
  const duplicate = voen ? await db().prepare("SELECT id, name FROM customers WHERE voen = ? AND COALESCE(country, '') = COALESCE(?, '') AND id != ?").bind(voen, country, input.id).first<{ id: number; name: string }>() : null;
  if (duplicate) throw new Error(`Bu VÖEN/FİN artıq "${duplicate.name}" müştərisində qeydə alınıb. Təkrar müştəri kartı yaradıla bilməz.`);
  await db().prepare("UPDATE customers SET entity_type = ?, country = ?, voen = ?, name = ?, legal_address = ?, legal_address2 = ?, manager = ?, phone = ? WHERE id = ?")
    .bind(
      entityType,
      country,
      voen,
      name,
      legalAddress,
      input.legalAddress2 ?? current.legal_address2,
      manager,
      phone,
      input.id,
    ).run();
}

export async function deleteCustomer(id: number) {
  await ensureSchema();
  const usage = await customerUsageSql();
  const used = await db().prepare(`SELECT ${usage.outgoing} AS outgoing, ${usage.incoming} AS incoming, ${usage.hr} AS hr FROM customers WHERE id = ?`).bind(id).first<{ outgoing: number; incoming: number; hr: number }>();
  if (used && used.outgoing + used.incoming + used.hr > 0) {
    const parts = [used.outgoing ? `${used.outgoing} çıxan sənəd` : "", used.incoming ? `${used.incoming} daxil olan sənəd` : "", used.hr ? `${used.hr} işçinin əvvəlki iş yeri` : ""].filter(Boolean).join(", ");
    throw new Error(`Bu müştəri istifadə olunur (${parts}) — silinə bilməz.`);
  }
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
  if (!title) throw new Error("Nöqsanın başlığını yazın.");
  if (!input.employeeId) throw new Error("Personal seçin.");
  await db().prepare(`INSERT INTO employee_violations (employee_id, company_id, title, note, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(input.employeeId, input.companyId || null, title, input.note?.trim() || null, input.createdByName || null, new Date().toISOString()).run();
}

export async function deleteViolation(id: number) {
  await ensureSchema();
  await db().prepare("DELETE FROM employee_violations WHERE id = ?").bind(id).run();
}

// Nöqsanlar managed by an employee: the people and firms they may pick from (narrowed to their departments in the route).
export async function violationTargets(companyIds: number[]) {
  await ensureSchema();
  if (!companyIds.length) return { employees: [], companies: [] };
  const marks = companyIds.map(() => "?").join(",");
  const [employees, companies] = await Promise.all([
    db().prepare(`SELECT DISTINCT e.id, e.name, (SELECT group_concat(company_id) FROM employee_companies x WHERE x.employee_id = e.id) AS company_ids
      FROM employees e JOIN employee_companies ec ON ec.employee_id = e.id WHERE e.active = 1 AND ec.company_id IN (${marks}) ORDER BY e.name`).bind(...companyIds).all(),
    db().prepare(`SELECT id, name FROM companies WHERE active = 1 AND id IN (${marks}) ORDER BY name`).bind(...companyIds).all(),
  ]);
  return { employees: employees.results, companies: companies.results };
}
export async function updateViolation(input: { id: number; companyId?: number | null; title: string; note?: string }) {
  await ensureSchema();
  const title = input.title?.trim();
  if (!title) throw new Error("Nöqsanın başlığını yazın.");
  await db().prepare("UPDATE employee_violations SET company_id = ?, title = ?, note = ? WHERE id = ?")
    .bind(input.companyId || null, title, input.note?.trim() || null, input.id).run();
}

export async function updateRecurring(input: { id: number; active?: boolean }) {
  await db().prepare("UPDATE recurring_tasks SET active = ? WHERE id = ?").bind(Number(input.active), input.id).run();
}

// Versiya 3.12: Ana səhifə → "Mənim performansım" — one employee's own card, tasks, fixed works and violations; the page counts
// the periods, the indicators and the score from these.
export async function getPerformanceData(employeeId: number) {
  await ensureSchema();
  const [employee, positions, tasks, assignments, completions, violations] = await Promise.all([
    db().prepare("SELECT id, name, email, avatar_key FROM employees WHERE id = ?").bind(employeeId).first<Record<string, unknown>>(),
    db().prepare(`SELECT c.name AS company_name, p.title, p.department FROM employee_companies ec JOIN companies c ON c.id = ec.company_id
      LEFT JOIN company_structure_positions p ON p.id = ec.position_id AND p.company_id = ec.company_id
      WHERE ec.employee_id = ? ORDER BY c.name`).bind(employeeId).all(),
    db().prepare(`SELECT t.id, t.title, t.status, t.due_at, t.created_at, t.completed_at, t.submitted_at, t.evaluation, t.evaluation_note, c.name AS company_name,
      (SELECT id FROM work_requests WHERE work_requests.task_id = t.id) AS request_id
      FROM tasks t LEFT JOIN companies c ON c.id = t.company_id WHERE t.employee_id = ? ORDER BY t.due_at DESC`).bind(employeeId).all(),
    db().prepare(`SELECT a.id, a.employee_id, a.company_id, a.created_at, d.title, d.frequency, d.due_day, d.due_month, c.name AS company_name
      FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id JOIN companies c ON c.id = a.company_id
      WHERE a.employee_id = ?`).bind(employeeId).all(),
    db().prepare(`SELECT x.work_assignment_id, x.period_key, x.completed_at FROM work_assignment_completions x
      JOIN work_assignments a ON a.id = x.work_assignment_id WHERE a.employee_id = ?`).bind(employeeId).all(),
    db().prepare("SELECT id, title, created_at FROM employee_violations WHERE employee_id = ? ORDER BY created_at DESC").bind(employeeId).all(),
  ]);
  if (!employee) throw new Error("İşçi kartı tapılmadı.");
  return { employee, positions: positions.results, tasks: tasks.results, assignments: assignments.results, completions: completions.results,
    violations: violations.results, fixedWorksStart: await getFixedWorksStart() };
}
