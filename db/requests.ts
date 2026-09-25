import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";

// "Sorğular": horizontal requests between departments (e.g. Təchizat → Mühasibatlıq). Unlike tasks, which go down the
// hierarchy, a request goes to a department of a company; that department's head accepts it (and picks who handles it)
// or rejects it with a reason, the handler answers it, and the requester closes it once satisfied.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

export const REQUEST_STATUSES = ["Yeni", "Qəbul edildi", "İcra olunur", "Cavablandı", "Bağlandı", "İmtina edildi"] as const;
const CLOSED = new Set(["Bağlandı", "İmtina edildi"]);

let schemaReady = false;
async function ensureRequestSchema() {
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
type RequestRow = Record<string, unknown> & { id: number; company_id: number; from_user_id: number; from_department: string | null; to_department: string; assignee_employee_id: number | null; status: string };

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
  // The admin can always step in; a department with no head on staff is handled by the admin alone.
  const manages = isTargetHead || isAdmin;
  const handles = isAssignee || manages;
  const status = row.status;
  const can = {
    accept: status === "Yeni" && manages,
    reject: (status === "Yeni" || status === "Qəbul edildi") && manages,
    reassign: (status === "Qəbul edildi" || status === "İcra olunur") && manages,
    start: status === "Qəbul edildi" && handles,
    answer: (status === "Qəbul edildi" || status === "İcra olunur") && handles,
    close: status === "Cavablandı" && (isRequester || isAdmin),
    reopen: status === "Cavablandı" && isRequester,
    remove: status === "Yeni" && (isRequester || isAdmin),
    comment: !CLOSED.has(status),
  };
  const actionable = (status === "Yeni" && (isTargetHead || (isAdmin && !targetHasHead)))
    || (status === "Qəbul edildi" && isAssignee)
    || (status === "Cavablandı" && isRequester);
  return {
    visible: isAdmin || isRequester || isTargetHead || isAssignee || isSourceHead,
    box: isRequester ? "outgoing" : isTargetHead || isAssignee || (isAdmin && !isSourceHead) ? "incoming" : "oversight",
    can,
    actionable,
  };
}

async function allRows() {
  return (await db().prepare(`SELECT r.*, c.name AS company_name, u.name AS from_name, a.name AS assignee_name
    FROM work_requests r
    JOIN companies c ON c.id = r.company_id
    LEFT JOIN app_users u ON u.id = r.from_user_id
    LEFT JOIN employees a ON a.id = r.assignee_employee_id
    ORDER BY r.created_at DESC, r.id DESC`).all<RequestRow>()).results;
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
  const order = new Map(structure.positions.map((p, index) => [`${p.company_id}|${p.department.trim()}`, index]));
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
  const row = await db().prepare("SELECT * FROM work_requests WHERE id = ?").bind(id).first<RequestRow>();
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

export async function updateRequest(user: SessionUser, input: { id: number; action: string; assigneeId?: number; agreedDueAt?: string; text?: string }) {
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
      await set("status = 'Qəbul edildi', assignee_employee_id = ?, agreed_due_at = ?", person.id, agreed);
      await logEvent(row.id, user.name, "Sorğu qəbul edildi", `İcraçı: ${person.name}${agreed ? `\nRazılaşdırılmış tarix: ${agreed.split("-").reverse().join(".")}` : ""}`);
      return;
    }
    case "reassign": {
      if (!can.reassign) throw new Error("İcraçını dəyişə bilməzsiniz.");
      const person = assignee();
      await set("assignee_employee_id = ?", person.id);
      await logEvent(row.id, user.name, "İcraçı dəyişdirildi", person.name);
      return;
    }
    case "reject":
      if (!can.reject) throw new Error("Bu sorğunu rədd edə bilməzsiniz.");
      if (!text) throw new Error("İmtinanın səbəbini yazın.");
      await set("status = 'İmtina edildi', reject_reason = ?, closed_at = ?", text, now);
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
      await logEvent(row.id, user.name, "Cavab qəbul edilmədi, sorğu yenidən açıldı", text);
      return;
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
