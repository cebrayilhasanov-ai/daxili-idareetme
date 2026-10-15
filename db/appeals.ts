import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import { copyFiles, removeFiles, setFiles, withFiles, type FileRef } from "@/db/attachments";
import { createPersonalWork } from "@/db/catalog";

// Versiya 3.27: "Rəhbərə müraciət" — an employee tells their head about something found while doing a fixed work (e.g. a
// notice in E-məhkəmə) or a step of a personal work. It goes up the firm's structure to the employee's direct head (the holders
// of the position(s) theirs reports to; a vacant one passes it a level higher; nobody above → the admin). The head does not get
// new actions here: they either turn it into a Şəxsi iş of their own (and go on from there with Ver / Şöbəyə sorğu), or close
// it with a short reply ("Məlumat alındı"). The appeal's status follows that personal work, so the employee sees how it ended.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

export const APPEAL_SENT = "Göndərilib";
export const APPEAL_TAKEN = "İşə götürülüb";
export const APPEAL_DONE = "İcra olunub";
export const APPEAL_NOTED = "Məlumat alındı";

let schemaReady = false;
async function ensureAppealSchema() {
  if (schemaReady) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS head_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,
    from_employee_id INTEGER,
    from_name TEXT NOT NULL,
    to_employee_ids TEXT NOT NULL DEFAULT '',
    to_admin INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT,
    urgent INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    period_key TEXT,
    source_label TEXT,
    status TEXT NOT NULL DEFAULT 'Göndərilib',
    handled_by_user_id INTEGER,
    handled_by_name TEXT,
    reply TEXT,
    personal_work_id INTEGER,
    created_at TEXT NOT NULL,
    handled_at TEXT
  )`).run();
  await db().prepare("CREATE INDEX IF NOT EXISTS head_appeals_source ON head_appeals (source_type, source_id)").run();
  // Versiya 3.28: the status the sender last saw — an answer (a status other than this one) shows in their bell until then.
  const columns = (await db().prepare("PRAGMA table_info(head_appeals)").all<{ name: string }>()).results;
  if (!columns.some((column) => column.name === "sender_seen_status")) await db().prepare("ALTER TABLE head_appeals ADD COLUMN sender_seen_status TEXT").run();
  schemaReady = true;
}

type Position = { id: number; department: string; title: string; reports_to: string | null };

// The employee's direct head in a firm: up from their position(s) along "reports_to" ("/" splits several superiors; a
// department name there means every position of that department — as in getDelegateCandidates). The first level held by
// someone with an active login gives the heads; a vacant level is passed over to the one above it.
async function headsOf(companyId: number, employeeId: number) {
  const positions = (await db().prepare("SELECT id, department, title, reports_to FROM company_structure_positions WHERE company_id = ?").bind(companyId).all<Position>()).results;
  const holders = (await db().prepare(`SELECT ec.employee_id, ec.position_id FROM employee_companies ec
    JOIN employees e ON e.id = ec.employee_id AND e.active = 1
    JOIN app_users u ON u.employee_id = ec.employee_id AND u.active = 1
    WHERE ec.company_id = ? AND ec.position_id IS NOT NULL`).bind(companyId).all<{ employee_id: number; position_id: number }>()).results;
  const own = (await db().prepare("SELECT position_id FROM employee_companies WHERE company_id = ? AND employee_id = ? AND position_id IS NOT NULL").bind(companyId, employeeId).all<{ position_id: number }>()).results;
  const titles = new Set(positions.map((p) => p.title.trim()));
  const parents = (child: Position) => {
    const parts = (child.reports_to || "").split("/").map((part) => part.trim()).filter(Boolean);
    return positions.filter((p) => p.id !== child.id && parts.some((part) => part === p.title.trim() || (!titles.has(part) && part === p.department.trim())));
  };
  const heads = new Set<number>();
  const visited = new Set<number>(own.map((o) => o.position_id));
  const queue = positions.filter((p) => visited.has(p.id)).flatMap(parents);
  while (queue.length) {
    const position = queue.shift()!;
    if (visited.has(position.id)) continue;
    visited.add(position.id);
    const people = holders.filter((h) => h.position_id === position.id && h.employee_id !== employeeId);
    if (people.length) people.forEach((h) => heads.add(h.employee_id));
    else queue.push(...parents(position));
  }
  return [...heads];
}

const idList = (ids: number[]) => (ids.length ? `,${ids.join(",")},` : "");
const isRecipient = (row: Record<string, unknown>, user: SessionUser) =>
  user.role === "admin" ? Boolean(row.to_admin) : Boolean(user.employeeId && String(row.to_employee_ids || "").includes(`,${user.employeeId},`));

const APPEAL_SQL = `SELECT a.*, c.name AS company_name, w.status AS work_status
  FROM head_appeals a
  LEFT JOIN companies c ON c.id = a.company_id
  LEFT JOIN personal_works w ON w.id = a.personal_work_id`;

// Who the appeal went to, by name; and the status shown — "İcra olunub" once the head's personal work is completed.
async function present(rows: Array<Record<string, unknown> & { id: number }>) {
  const ids = new Set<number>();
  for (const row of rows) String(row.to_employee_ids || "").split(",").filter(Boolean).forEach((id) => ids.add(Number(id)));
  const names = new Map<number, string>();
  if (ids.size) {
    const people = (await db().prepare(`SELECT id, name FROM employees WHERE id IN (${[...ids].map(() => "?").join(",")})`).bind(...ids).all<{ id: number; name: string }>()).results;
    people.forEach((p) => names.set(p.id, p.name));
  }
  const shown = rows.map((row): Record<string, unknown> & { id: number } => ({
    ...row,
    status: row.status === APPEAL_TAKEN && row.work_status === "Tamamlanıb" ? APPEAL_DONE : row.status,
    to_names: [...String(row.to_employee_ids || "").split(",").filter(Boolean).map((id) => names.get(Number(id)) || "—"), ...(row.to_admin ? ["Admin"] : [])],
  }));
  return withFiles(shown, "appeal");
}

async function requireAppeal(id: number) {
  await ensureAppealSchema();
  const row = await db().prepare("SELECT * FROM head_appeals WHERE id = ?").bind(id).first<Record<string, unknown> & { id: number }>();
  if (!row) throw new Error("Müraciət tapılmadı.");
  return row;
}

// Where an appeal is sent from: a period of one's own fixed work, or a step of one's own personal work (which needs a firm).
async function sourceOf(user: SessionUser, input: { sourceType: string; sourceId: number; periodKey?: string; periodLabel?: string }) {
  if (input.sourceType === "fixed") {
    const row = await db().prepare(`SELECT a.employee_id, a.company_id, d.title FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ?`)
      .bind(input.sourceId).first<{ employee_id: number; company_id: number; title: string }>();
    if (!row) throw new Error("Sabit iş tapılmadı.");
    if (!user.employeeId || row.employee_id !== user.employeeId) throw new Error("Bu sabit iş sizə aid deyil.");
    const periodKey = String(input.periodKey || "").slice(0, 20);
    if (!periodKey) throw new Error("Dövr seçilməyib.");
    const label = String(input.periodLabel || periodKey).slice(0, 60);
    return { companyId: row.company_id, periodKey, label: `Sabit iş: ${row.title} — ${label}` };
  }
  if (input.sourceType === "step") {
    const row = await db().prepare(`SELECT i.title AS step_title, w.title AS work_title, w.user_id, w.company_id FROM personal_work_checklist_items i
      JOIN personal_works w ON w.id = i.personal_work_id WHERE i.id = ?`).bind(input.sourceId).first<{ step_title: string; work_title: string; user_id: number; company_id: number | null }>();
    if (!row) throw new Error("Addım tapılmadı.");
    if (row.user_id !== user.id) throw new Error("Bu iş sizə aid deyil.");
    if (!row.company_id) throw new Error("Rəhbərə müraciət üçün işin firmasını seçin (Redaktə et).");
    return { companyId: row.company_id, periodKey: null, label: `Şəxsi iş: ${row.work_title} — ${row.step_title}` };
  }
  throw new Error("Müraciətin mənbəyi düzgün deyil.");
}

export async function createAppeal(user: SessionUser, input: { sourceType: string; sourceId: number; periodKey?: string; periodLabel?: string; title: string; description?: string; urgent?: boolean; files?: FileRef[] }) {
  await ensureAppealSchema();
  if (user.role === "admin") throw new Error("Admin hesabı müraciət göndərmir.");
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Müraciətin mövzusunu yazın.");
  if (title.length > 200) throw new Error("Mövzu 200 simvoldan uzun ola bilməz.");
  const description = String(input.description || "").trim();
  if (description.length > 4000) throw new Error("İzah 4000 simvoldan uzun ola bilməz.");
  const source = await sourceOf(user, input);
  const heads = user.employeeId ? await headsOf(source.companyId, user.employeeId) : [];
  const result = await db().prepare(`INSERT INTO head_appeals (company_id, from_user_id, from_employee_id, from_name, to_employee_ids, to_admin, title, description, urgent,
    source_type, source_id, period_key, source_label, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(source.companyId, user.id, user.employeeId, user.name, idList(heads), heads.length ? 0 : 1, title, description || null, input.urgent ? 1 : 0,
      input.sourceType, input.sourceId, source.periodKey, source.label, APPEAL_SENT, new Date().toISOString()).run();
  const id = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
  if (input.files?.length) await setFiles("appeal", id, input.files);
  return id;
}

// The two lists: what came to me (newest first, urgent open ones on top) and what I sent.
export async function getAppeals(user: SessionUser) {
  await ensureAppealSchema();
  const inbox = user.role === "admin"
    ? (await db().prepare(`${APPEAL_SQL} WHERE a.to_admin = 1 ORDER BY a.created_at DESC`).all<Record<string, unknown> & { id: number }>()).results
    : user.employeeId
      ? (await db().prepare(`${APPEAL_SQL} WHERE a.to_employee_ids LIKE ? ORDER BY a.created_at DESC`).bind(`%,${user.employeeId},%`).all<Record<string, unknown> & { id: number }>()).results
      : [];
  const sent = (await db().prepare(`${APPEAL_SQL} WHERE a.from_user_id = ? ORDER BY a.created_at DESC`).bind(user.id).all<Record<string, unknown> & { id: number }>()).results;
  const open = (row: Record<string, unknown>) => row.status === APPEAL_SENT;
  inbox.sort((a, b) => Number(open(b) && b.urgent) - Number(open(a) && a.urgent) || Number(open(b)) - Number(open(a)));
  return { inbox: await present(inbox), sent: await present(sent) };
}

// For the bell: the appeals still waiting for me.
export async function appealSummary(user: SessionUser) {
  await ensureAppealSchema();
  const rows = user.role === "admin"
    ? (await db().prepare("SELECT id, title, from_name, urgent FROM head_appeals WHERE status = ? AND to_admin = 1 ORDER BY urgent DESC, created_at DESC").bind(APPEAL_SENT).all<{ id: number; title: string; from_name: string; urgent: number }>()).results
    : user.employeeId
      ? (await db().prepare("SELECT id, title, from_name, urgent FROM head_appeals WHERE status = ? AND to_employee_ids LIKE ? ORDER BY urgent DESC, created_at DESC").bind(APPEAL_SENT, `%,${user.employeeId},%`).all<{ id: number; title: string; from_name: string; urgent: number }>()).results
      : [];
  // Versiya 3.28: the sender's side — appeals the head has answered (taken, "Məlumat alındı", or done) since the sender last looked.
  const sent = (await present((await db().prepare(`${APPEAL_SQL} WHERE a.from_user_id = ? AND a.status != ? ORDER BY COALESCE(a.handled_at, a.created_at) DESC`).bind(user.id, APPEAL_SENT).all<Record<string, unknown> & { id: number }>()).results))
    .filter((row) => row.status !== row.sender_seen_status)
    .map((row) => ({ id: row.id, title: String(row.title), status: String(row.status), handled_by_name: row.handled_by_name ? String(row.handled_by_name) : null }));
  return { pending: rows.length, items: rows.slice(0, 5), answered: sent.length, answers: sent.slice(0, 5) };
}

// The sender opened "Göndərdiyim müraciətlər": every answer there counts as seen (until the status changes again).
export async function markAppealAnswersSeen(user: SessionUser) {
  await ensureAppealSchema();
  const rows = await present((await db().prepare(`${APPEAL_SQL} WHERE a.from_user_id = ? AND a.status != ?`).bind(user.id, APPEAL_SENT).all<Record<string, unknown> & { id: number }>()).results);
  for (const row of rows) if (row.status !== row.sender_seen_status) await db().prepare("UPDATE head_appeals SET sender_seen_status = ? WHERE id = ?").bind(String(row.status), row.id).run();
}

// The ✉ marks on fixed works' cells: the appeals sent from a period, for whoever may see them (sender, recipient, admin).
export async function fixedAppealMarks(user: SessionUser) {
  await ensureAppealSchema();
  const rows = (await db().prepare(`${APPEAL_SQL} WHERE a.source_type = 'fixed' ORDER BY a.created_at`).all<Record<string, unknown> & { id: number }>()).results
    .filter((row) => user.role === "admin" || row.from_user_id === user.id || isRecipient(row, user));
  return (await present(rows)).map((row) => ({ id: row.id, assignment_id: Number(row.source_id), period_key: String(row.period_key || ""), title: String(row.title), status: String(row.status), urgent: Boolean(row.urgent), created_at: String(row.created_at), from_name: String(row.from_name) }));
}

// "Şəxsi işə çevir": a personal work of the head's — the appeal's subject, its text (with who sent it and from where) and copies
// of its files, in the appeal's firm; the work's first step is made as for any new work.
export async function takeAppeal(user: SessionUser, id: number) {
  const row = await requireAppeal(id);
  if (user.role === "admin") throw new Error("Admin hesabı şəxsi iş yaratmır — müraciəti “Məlumat alındı” ilə bağlayın.");
  if (!isRecipient(row, user)) throw new Error("FORBIDDEN");
  if (row.status !== APPEAL_SENT) throw new Error("Bu müraciətə artıq baxılıb.");
  const [appealFiles] = await withFiles([row], "appeal");
  const files = await copyFiles((appealFiles.files as FileRef[]) || []);
  const description = [`Müraciət: ${row.from_name}${row.urgent ? " (təcili)" : ""}`, String(row.source_label || ""), String(row.description || "")].filter(Boolean).join("\n");
  const workId = await createPersonalWork({ userId: user.id, actorName: user.name, title: String(row.title), description, companyId: Number(row.company_id), files, priority: row.urgent ? "Yüksək" : "Orta" });
  await db().prepare("UPDATE head_appeals SET status = ?, handled_by_user_id = ?, handled_by_name = ?, personal_work_id = ?, handled_at = ? WHERE id = ?")
    .bind(APPEAL_TAKEN, user.id, user.name, workId, new Date().toISOString(), id).run();
  return workId;
}

export async function noteAppeal(user: SessionUser, id: number, reply: string) {
  const row = await requireAppeal(id);
  if (!isRecipient(row, user)) throw new Error("FORBIDDEN");
  if (row.status !== APPEAL_SENT) throw new Error("Bu müraciətə artıq baxılıb.");
  const text = String(reply || "").trim();
  if (text.length > 2000) throw new Error("Cavab 2000 simvoldan uzun ola bilməz.");
  await db().prepare("UPDATE head_appeals SET status = ?, handled_by_user_id = ?, handled_by_name = ?, reply = ?, handled_at = ? WHERE id = ?")
    .bind(APPEAL_NOTED, user.id, user.name, text || null, new Date().toISOString(), id).run();
}

// The sender may take an appeal back while nobody has looked at it yet.
export async function withdrawAppeal(user: SessionUser, id: number) {
  const row = await requireAppeal(id);
  if (row.from_user_id !== user.id) throw new Error("FORBIDDEN");
  if (row.status !== APPEAL_SENT) throw new Error("Rəhbər müraciətə baxıb — onu geri çağırmaq olmur.");
  await db().prepare("DELETE FROM head_appeals WHERE id = ?").bind(id).run();
  await removeFiles("appeal", id);
}
