import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";

// "Sorğular": horizontal requests between departments (e.g. Təchizat → Mühasibatlıq). Unlike tasks, which go down the
// hierarchy, a request goes to a department of a company; that department's head accepts it (and picks who handles it)
// or rejects it with a reason, the handler answers it, and the requester closes it once satisfied. Accepting creates a task
// for the chosen assignee; the request's status then follows that task, and the head scores it once the request is closed.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

export const REQUEST_STATUSES = ["Yeni", "Qəbul edildi", "İcra olunur", "Cavablandı", "Bağlandı", "İmtina edildi"] as const;
const CLOSED = new Set(["Bağlandı", "İmtina edildi"]);

let schemaReady = false;
export async function ensureRequestSchema() {
  if (schemaReady) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS work_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    from_user_id INTEGER NOT NULL,
    from_employee_id INTEGER REFERENCES employees(id),
    from_department TEXT,
    to_department TEXT NOT NULL,
    assignee_employee_id INTEGER REFERENCES employees(id),
    title TEXT NOT NULL,
    description TEXT,
    desired_due_at TEXT,
    agreed_due_at TEXT,
    status TEXT NOT NULL DEFAULT 'Yeni',
    reject_reason TEXT,
    attachment_key TEXT,
    attachment_name TEXT,
    attachment_size INTEGER,
    attachment_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS work_request_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    request_id INTEGER NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
    actor_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'event',
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const columns = await db().prepare("PRAGMA table_info(work_requests)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "task_id")) await db().prepare("ALTER TABLE work_requests ADD COLUMN task_id INTEGER REFERENCES tasks(id)").run();
  schemaReady = true;
}

type Member = { id: number; name: string; position_title: string };
type Position = { id: number; company_id: number; department: string; title: string; reports_to: string | null };

// Who belongs to which department of which company (via the employee's position in that company's structure), and who
// heads it: the holders of the department's top position(s) — a position whose superior is outside the department. When
// that position is vacant, the holders of the positions right under it act as heads (same rule as task delegation).
async function loadStructure() {
  const positions = (await db().prepare("SELECT id, company_id, department, title, reports_to FROM company_structure_positions").all<Position>()).results;
  const holders = (await db().prepare(`SELECT ec.employee_id, ec.position_id, e.name
    FROM employee_companies ec JOIN employees e ON e.id = ec.employee_id
    WHERE ec.position_id IS NOT NULL AND e.active = 1 ORDER BY e.name`).all<{ employee_id: number; position_id: number; name: string }>()).results;
  const byPosition = new Map<number, Array<{ employee_id: number; name: string }>>();
  for (const h of holders) byPosition.set(h.position_id, [...(byPosition.get(h.position_id) ?? []), h]);
  const key = (companyId: number, department: string) => `${companyId}|${department.trim()}`;
  const departments = new Map<string, { members: Member[]; heads: Set<number> }>();
  const groups = new Map<string, Position[]>();
  for (const p of positions) groups.set(key(p.company_id, p.department), [...(groups.get(key(p.company_id, p.department)) ?? []), p]);
  for (const [groupKey, group] of groups) {
    const titles = new Set(group.map((p) => p.title.trim()));
    const superiors = (p: Position) => (p.reports_to || "").split("/").map((part) => part.trim()).filter(Boolean);
    const members: Member[] = [];
    for (const p of group) for (const h of byPosition.get(p.id) ?? []) if (!members.some((m) => m.id === h.employee_id)) members.push({ id: h.employee_id, name: h.name, position_title: p.title });
    const heads = new Set<number>();
    const visited = new Set<number>();
    const queue = group.filter((p) => !superiors(p).some((s) => titles.has(s)));
    while (queue.length) {
      const p = queue.shift()!;
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      const people = byPosition.get(p.id) ?? [];
      if (people.length) people.forEach((h) => heads.add(h.employee_id));
      else queue.push(...group.filter((c) => !visited.has(c.id) && superiors(c).includes(p.title.trim())));
    }
    departments.set(groupKey, { members, heads });
  }
  const departmentOf = (companyId: number, employeeId: number | null) => {
    if (!employeeId) return null;
    for (const p of positions) if (p.company_id === companyId && (byPosition.get(p.id) ?? []).some((h) => h.employee_id === employeeId)) return p.department.trim();
    return null;
  };
  return { positions, departments, key, departmentOf };
}

type Structure = Awaited<ReturnType<typeof loadStructure>>;
type RequestRow = Record<string, unknown> & { id: number; company_id: number; from_user_id: number; from_department: string | null; to_department: string; assignee_employee_id: number | null; status: string; task_id: number | null; task_status: string | null };

function roles(row: RequestRow, user: SessionUser, structure: Structure) {
  const isAdmin = user.role === "admin";
  const me = user.employeeId;
  const target = structure.departments.get(structure.key(row.company_id, row.to_department));
  const source = row.from_department ? structure.departments.get(structure.key(row.company_id, row.from_department)) : undefined;
  const targetHasHead = Boolean(target?.heads.size);
  const isTargetHead = Boolean(me && target?.heads.has(me));
  const isRequester = row.from_user_id === user.id;
  const isAssignee = Boolean(me && row.assignee_employee_id === me);
  const isSourceHead = Boolean(me && source?.heads.has(me));
  // Once accepted, the request lives on as a task of the assignee ("Tapşırıqlarım"): the assignee works it from there and
  // the request's status follows the task. Requests accepted before tasks were linked keep being worked from here.
  const linked = Boolean(row.task_id);
  // The admin can always step in; a department with no head on staff is handled by the admin alone.
  const manages = isTargetHead || isAdmin;
  const handles = isAssignee || manages;
  const status = row.status;
  const can = {
    accept: status === "Yeni" && manages,
    reject: (status === "Yeni" || status === "Qəbul edildi") && manages,
    reassign: (status === "Qəbul edildi" || status === "İcra olunur") && manages,
    start: status === "Qəbul edildi" && handles && !linked,
    answer: (status === "Qəbul edildi" || status === "İcra olunur") && handles && !linked,
    close: status === "Cavablandı" && (isRequester || isAdmin),
    reopen: status === "Cavablandı" && isRequester,
    remove: status === "Yeni" && (isRequester || isAdmin),
    comment: !CLOSED.has(status),
    // The head scores the assignee's work only after the requester has closed the request.
    evaluate: status === "Bağlandı" && linked && row.task_status === "Təqdim edilib" && manages,
  };
  const leadsTarget = isTargetHead || (isAdmin && !targetHasHead);
  const actionable = (status === "Yeni" && leadsTarget)
    || (status === "Qəbul edildi" && isAssignee && !linked)
    || (status === "Cavablandı" && isRequester)
    || (can.evaluate && leadsTarget);
  return {
    visible: isAdmin || isRequester || isTargetHead || (isAssignee && !linked) || isSourceHead,
    box: isRequester ? "outgoing" : isTargetHead || isAssignee || (isAdmin && !isSourceHead) ? "incoming" : "oversight",
    can,
    actionable,
  };
}

async function allRows() {
  return (await db().prepare(`SELECT r.*, c.name AS company_name, u.name AS from_name, a.name AS assignee_name,
      t.status AS task_status, t.evaluation AS task_evaluation, t.evaluation_note AS task_evaluation_note,
      t.submission_attachment_key, t.submission_attachment_name, t.submission_attachment_size
    FROM work_requests r
    JOIN companies c ON c.id = r.company_id
    LEFT JOIN app_users u ON u.id = r.from_user_id
    LEFT JOIN employees a ON a.id = r.assignee_employee_id
    LEFT JOIN tasks t ON t.id = r.task_id
    ORDER BY r.created_at DESC, r.id DESC`).all<RequestRow>()).results;
}

// The accepted request becomes a task of the assignee. The task gets its own copy of the request's file, so removing
// either one never orphans the other (same as when a checklist step is handed over).
async function createLinkedTask(row: RequestRow, employeeId: number, dueDate: string) {
  let attachment: { key: string; name: string | null; size: number | null; type: string | null } | null = null;
  if (row.attachment_key && env.FILES) {
    const source = await env.FILES.get(String(row.attachment_key));
    if (source) {
      const copyKey = `${crypto.randomUUID()}-${String(row.attachment_name || "fayl").replace(/[^\p{L}\p{N}._-]+/gu, "_")}`;
      await env.FILES.put(copyKey, await source.arrayBuffer(), { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata });
      attachment = { key: copyKey, name: (row.attachment_name as string | null) ?? null, size: (row.attachment_size as number | null) ?? null, type: (row.attachment_type as string | null) ?? null };
    }
  }
  const sender = await db().prepare("SELECT name FROM app_users WHERE id = ?").bind(row.from_user_id).first<{ name: string }>();
  const from = `${sender?.name || "—"}${row.from_department ? ` (${row.from_department})` : ""}`;
  const description = `Sorğunu göndərən: ${from}${row.description ? `\n\n${row.description}` : ""}`;
  // End of the agreed day, Baku time (UTC+4).
  const dueAt = new Date(`${dueDate}T18:00:00+04:00`).toISOString();
  const result = await db().prepare(`INSERT INTO tasks
    (employee_id, company_id, title, description, due_at, original_due_at, status, created_at, attachment_key, attachment_name, attachment_size, attachment_type) VALUES (?, ?, ?, ?, ?, ?, 'Yeni', ?, ?, ?, ?, ?)`)
    .bind(employeeId, row.company_id, `Sorğu №${row.id}: ${row.title}`, description, dueAt, dueAt, new Date().toISOString(), attachment?.key ?? null, attachment?.name ?? null, attachment?.size ?? null, attachment?.type ?? null).run();
  return Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
}

async function dropLinkedTask(taskId: number | null) {
  if (!taskId) return;
  const task = await db().prepare("SELECT attachment_key, submission_attachment_key FROM tasks WHERE id = ?").bind(taskId).first<{ attachment_key: string | null; submission_attachment_key: string | null }>();
  if (!task) return;
  await db().prepare("UPDATE personal_work_checklist_items SET delegated_task_id = NULL, delegated_employee_id = NULL WHERE delegated_task_id = ?").bind(taskId).run();
  await db().prepare("UPDATE task_checklist_items SET delegated_task_id = NULL, delegated_employee_id = NULL WHERE delegated_task_id = ?").bind(taskId).run();
  await db().prepare("DELETE FROM tasks WHERE id = ?").bind(taskId).run();
  if (env.FILES) for (const key of [task.attachment_key, task.submission_attachment_key]) if (key) await env.FILES.delete(key);
}

export async function requestForTask(taskId: number) {
  await ensureRequestSchema();
  return db().prepare("SELECT id, status FROM work_requests WHERE task_id = ?").bind(taskId).first<{ id: number; status: string }>();
}

// Called by updateTask after the assignee (or the admin, from the tasks page) moved a request-linked task.
export async function syncRequestFromTask(taskId: number, taskStatus: string, actorName: string | undefined, detail?: string | null) {
  const request = await requestForTask(taskId);
  if (!request) return;
  const now = new Date().toISOString();
  const move = (status: string) => db().prepare("UPDATE work_requests SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, request.id).run();
  if (taskStatus === "İcradadır" && request.status === "Qəbul edildi") {
    await move("İcra olunur");
    await logEvent(request.id, actorName || "İcraçı", "İcraçı işi icraya aldı");
  } else if (taskStatus === "Təqdim edilib" && request.status !== "Bağlandı") {
    await move("Cavablandı");
    await logEvent(request.id, actorName || "İcraçı", "Sorğu cavablandı", detail);
  } else if (taskStatus === "Geri qaytarılıb" && request.status !== "Bağlandı") {
    await move("İcra olunur");
    await logEvent(request.id, actorName || "Rəhbər", "İş icraçıya geri qaytarıldı", detail);
  } else if (taskStatus === "Təsdiqlənib") {
    await logEvent(request.id, actorName || "Rəhbər", "İcraçının işi qiymətləndirildi ✓", detail);
  }
}

async function userCompanyIds(user: SessionUser): Promise<number[]> {
  if (user.role === "admin") return (await db().prepare("SELECT id FROM companies WHERE active = 1").all<{ id: number }>()).results.map((c) => c.id);
  if (!user.employeeId) return [];
  return (await db().prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(user.employeeId).all<{ company_id: number }>()).results.map((c) => c.company_id);
}

export async function listRequests(user: SessionUser) {
  await ensureRequestSchema();
  const structure = await loadStructure();
  const items = (await allRows()).flatMap((row) => {
    const r = roles(row, user, structure);
    return r.visible ? [{ ...row, box: r.box, can: r.can, actionable: r.actionable }] : [];
  });
  // The departments a request can be sent to, and — for departments this user manages — who a request can be handed to.
  const companyIds = new Set(await userCompanyIds(user));
  const departments: Record<string, string[]> = {};
  const members: Record<string, Member[]> = {};
  for (const [groupKey, dept] of structure.departments) {
    const [companyId, name] = [Number(groupKey.split("|")[0]), groupKey.slice(groupKey.indexOf("|") + 1)];
    if (companyIds.has(companyId)) (departments[companyId] ??= []).push(name);
    if (user.role === "admin" || (user.employeeId && dept.heads.has(user.employeeId))) members[groupKey] = dept.members;
  }
  const order = new Map<string, number>(structure.positions.map((p: Position, index: number): [string, number] => [`${p.company_id}|${p.department.trim()}`, index]));
  for (const companyId of Object.keys(departments)) departments[companyId].sort((a, b) => (order.get(`${companyId}|${a}`) ?? 0) - (order.get(`${companyId}|${b}`) ?? 0));
  const myDepartments: Record<string, string | null> = {};
  for (const companyId of companyIds) myDepartments[companyId] = structure.departmentOf(companyId, user.employeeId);
  return { items, departments, members, myDepartments };
}

export async function countActionableRequests(user: SessionUser) {
  await ensureRequestSchema();
  const structure = await loadStructure();
  return (await allRows()).filter((row) => roles(row, user, structure).actionable).length;
}

export async function getRequestEvents(user: SessionUser, id: number) {
  await ensureRequestSchema();
  await requireRow(user, id);
  return (await db().prepare("SELECT id, actor_name, kind, action, detail, created_at FROM work_request_events WHERE request_id = ? ORDER BY created_at, id").bind(id).all()).results;
}

async function logEvent(requestId: number, actorName: string, action: string, detail?: string | null, kind: "event" | "comment" = "event") {
  await db().prepare("INSERT INTO work_request_events (request_id, actor_name, kind, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(requestId, actorName || "Naməlum", kind, action, detail?.trim() || null, new Date().toISOString()).run();
}

async function requireRow(user: SessionUser, id: number) {
  const row = await db().prepare("SELECT r.*, t.status AS task_status FROM work_requests r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.id = ?").bind(id).first<RequestRow>();
  if (!row) throw new Error("Sorğu tapılmadı.");
  const structure = await loadStructure();
  const r = roles(row, user, structure);
  if (!r.visible) throw new Error("Bu sorğu sizə aid deyil.");
  return { row, ...r, structure };
}

const dateOnly = (value: unknown) => {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Tarix düzgün deyil.");
  return text;
};

export async function createRequest(user: SessionUser, input: { companyId: number; toDepartment: string; title: string; description?: string; desiredDueAt?: string; attachmentKey?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) {
  await ensureRequestSchema();
  const title = input.title?.trim();
  const toDepartment = input.toDepartment?.trim();
  if (!input.companyId) throw new Error("Firma seçilməyib.");
  if (!toDepartment) throw new Error("Sorğunun göndəriləcəyi şöbəni seçin.");
  if (!title) throw new Error("Sorğunun mövzusunu yazın.");
  if (!(await userCompanyIds(user)).includes(input.companyId)) throw new Error("Bu firmada işləmirsiniz.");
  const structure = await loadStructure();
  if (!structure.departments.has(structure.key(input.companyId, toDepartment))) throw new Error("Bu şöbə firmanın strukturunda yoxdur.");
  const now = new Date().toISOString();
  const result = await db().prepare(`INSERT INTO work_requests
    (company_id, from_user_id, from_employee_id, from_department, to_department, title, description, desired_due_at, status, attachment_key, attachment_name, attachment_size, attachment_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Yeni', ?, ?, ?, ?, ?, ?)`)
    .bind(input.companyId, user.id, user.employeeId, structure.departmentOf(input.companyId, user.employeeId), toDepartment, title, input.description?.trim() || null, dateOnly(input.desiredDueAt),
      input.attachmentKey || null, input.attachmentName || null, input.attachmentSize || null, input.attachmentType || null, now, now).run();
  const id = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  await logEvent(id, user.name, "Sorğu göndərildi", `${toDepartment} şöbəsinə`);
}

export async function updateRequest(user: SessionUser, input: { id: number; action: string; assigneeId?: number; agreedDueAt?: string; text?: string; score?: number }) {
  await ensureRequestSchema();
  const { row, can, structure } = await requireRow(user, input.id);
  const text = input.text?.trim() || "";
  const now = new Date().toISOString();
  const set = (sql: string, ...values: unknown[]) => db().prepare(`UPDATE work_requests SET ${sql}, updated_at = ? WHERE id = ?`).bind(...values, now, row.id).run();
  const assignee = () => {
    const members = structure.departments.get(structure.key(row.company_id, row.to_department))?.members ?? [];
    const person = members.find((m) => m.id === Number(input.assigneeId));
    if (!person) throw new Error("İcraçını şöbənin əməkdaşları arasından seçin.");
    return person;
  };
  switch (input.action) {
    case "accept": {
      if (!can.accept) throw new Error("Bu sorğunu qəbul edə bilməzsiniz.");
      const person = assignee();
      const agreed = dateOnly(input.agreedDueAt) ?? (row.desired_due_at as string | null);
      if (!agreed) throw new Error("Razılaşdırılmış tarixi seçin.");
      const taskId = await createLinkedTask(row, person.id, agreed);
      await set("status = 'Qəbul edildi', assignee_employee_id = ?, agreed_due_at = ?, task_id = ?", person.id, agreed, taskId);
      await logEvent(row.id, user.name, "Sorğu qəbul edildi", `İcraçı: ${person.name} (tapşırıq kimi verildi)\nRazılaşdırılmış tarix: ${agreed.split("-").reverse().join(".")}`);
      return;
    }
    case "reassign": {
      if (!can.reassign) throw new Error("İcraçını dəyişə bilməzsiniz.");
      const person = assignee();
      if (row.task_id) {
        // The old assignee's task is withdrawn and the new assignee starts from a fresh one.
        await dropLinkedTask(row.task_id);
        const taskId = await createLinkedTask(row, person.id, String(row.agreed_due_at || row.desired_due_at || now.slice(0, 10)));
        await set("assignee_employee_id = ?, task_id = ?, status = 'Qəbul edildi'", person.id, taskId);
      } else await set("assignee_employee_id = ?", person.id);
      await logEvent(row.id, user.name, "İcraçı dəyişdirildi", person.name);
      return;
    }
    case "reject":
      if (!can.reject) throw new Error("Bu sorğunu rədd edə bilməzsiniz.");
      if (!text) throw new Error("İmtinanın səbəbini yazın.");
      await dropLinkedTask(row.task_id);
      await set("status = 'İmtina edildi', reject_reason = ?, closed_at = ?, task_id = NULL", text, now);
      await logEvent(row.id, user.name, "Sorğudan imtina edildi", `Səbəb: ${text}`);
      return;
    case "start":
      if (!can.start) throw new Error("Bu sorğunu icraya ala bilməzsiniz.");
      await set("status = 'İcra olunur'");
      await logEvent(row.id, user.name, "Sorğu icraya alındı");
      return;
    case "answer":
      if (!can.answer) throw new Error("Bu sorğunu cavablandıra bilməzsiniz.");
      await set("status = 'Cavablandı'");
      await logEvent(row.id, user.name, "Sorğu cavablandı", text);
      return;
    case "close":
      if (!can.close) throw new Error("Bu sorğunu bağlaya bilməzsiniz.");
      await set("status = 'Bağlandı', closed_at = ?", now);
      await logEvent(row.id, user.name, "Sorğu bağlandı ✓", text);
      return;
    case "reopen":
      if (!can.reopen) throw new Error("Bu sorğunu yenidən aça bilməzsiniz.");
      if (!text) throw new Error("Nəyin çatışmadığını yazın.");
      await set("status = 'İcra olunur'");
      if (row.task_id) await db().prepare("UPDATE tasks SET status = 'Geri qaytarılıb', evaluation_note = ?, employee_status_changed = 1 WHERE id = ?").bind(`Sorğunu göndərən: ${text}`, row.task_id).run();
      await logEvent(row.id, user.name, "Cavab qəbul edilmədi, sorğu yenidən açıldı", text);
      return;
    case "evaluate": {
      if (!can.evaluate) throw new Error("Bu işi hələ qiymətləndirmək olmaz.");
      const score = Number(input.score);
      if (!(Number.isInteger(score) && score >= 1 && score <= 10)) throw new Error("Qiymət 1 ilə 10 arasında olmalıdır.");
      await db().prepare("UPDATE tasks SET status = 'Təsdiqlənib', evaluation = ?, evaluation_note = ?, completed_at = ? WHERE id = ?").bind(score, text || null, now, row.task_id).run();
      await set("status = status");
      await logEvent(row.id, user.name, "İcraçının işi qiymətləndirildi ✓", `${score}/10${text ? `\n${text}` : ""}`);
      return;
    }
    case "comment":
      if (!can.comment) throw new Error("Bağlanmış sorğuya şərh yazmaq olmaz.");
      if (!text) throw new Error("Şərhi yazın.");
      await set("status = status");
      await logEvent(row.id, user.name, "Şərh", text, "comment");
      return;
    default:
      throw new Error("Naməlum əməliyyat.");
  }
}

export async function deleteRequest(user: SessionUser, id: number) {
  await ensureRequestSchema();
  const { row, can } = await requireRow(user, id);
  if (!can.remove) throw new Error("Yalnız “Yeni” statuslu öz sorğunuzu silə bilərsiniz.");
  await db().prepare("DELETE FROM work_request_events WHERE request_id = ?").bind(row.id).run();
  await db().prepare("DELETE FROM work_requests WHERE id = ?").bind(row.id).run();
  if (row.attachment_key && env.FILES) await env.FILES.delete(String(row.attachment_key));
}
