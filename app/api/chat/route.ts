import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { companyDepartments } from "@/db/requests";
import { markSchemaCurrent, schemaIsCurrent } from "@/lib/schema-version";

type User = Awaited<ReturnType<typeof requireUser>>;

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// Versiya 3.11: a deleted message keeps its place as "Mesaj silindi" — its text and file are removed.
// Versiya 3.53: work groups (type 'team') besides the one "Ümumi işçi qrupu" (type 'group'). A team belongs to the department of
// the head who made it (company_id + department): whoever heads that department now manages it, so a new head takes it over.
// archived_at: closed by its manager — the members still read it, nobody writes.
const SCHEMA_VERSION = "3.53";
let chatSchemaReady = false;
async function ensureChatSchema() {
  if (chatSchemaReady) return;
  if (await schemaIsCurrent("chat", SCHEMA_VERSION)) { chatSchemaReady = true; return; }
  const columns = await env.DB.prepare("PRAGMA table_info(chat_messages)").all<{ name: string }>();
  if (!columns.results.some((column: { name: string }) => column.name === "deleted_at")) await env.DB.prepare("ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT").run();
  // Versiya 3.45: the thread list asks each thread's last message and unread count many times a day — without this index
  // every ask read all messages (most of D1's daily free row reads).
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages (thread_id, id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members (user_id)").run();
  const threadColumns = (await env.DB.prepare("PRAGMA table_info(chat_threads)").all<{ name: string }>()).results.map((column: { name: string }) => column.name);
  for (const column of ["company_id INTEGER", "department TEXT", "archived_at TEXT"]) {
    if (!threadColumns.includes(column.split(" ")[0])) await env.DB.prepare(`ALTER TABLE chat_threads ADD COLUMN ${column}`).run();
  }
  await markSchemaCurrent("chat", SCHEMA_VERSION);
  chatSchemaReady = true;
}

async function ensureGeneral(user: User) {
  await ensureChatSchema();
  let thread = await env.DB.prepare("SELECT id FROM chat_threads WHERE type = 'group' ORDER BY id LIMIT 1").first<{ id: number }>();
  if (!thread) {
    await env.DB.prepare("INSERT INTO chat_threads (type,name,created_by,created_at) VALUES ('group','Ümumi işçi qrupu',?,?)")
      .bind(user.id, new Date().toISOString()).run();
    thread = await env.DB.prepare("SELECT id FROM chat_threads WHERE type = 'group' ORDER BY id LIMIT 1").first<{ id: number }>();
  }
  if (!thread) throw new Error("Ümumi çat yaradıla bilmədi.");
  await env.DB.prepare(`INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at)
    SELECT ?, id, 0, ? FROM app_users WHERE active = 1`).bind(thread.id, new Date().toISOString()).run();
  return thread.id;
}

async function isMember(threadId: number, userId: number) {
  return env.DB.prepare("SELECT thread_id FROM chat_members WHERE thread_id = ? AND user_id = ?")
    .bind(threadId, userId).first();
}

// The departments (per firm) the user heads — the director heads the top one. Only they make work groups; the admin makes none.
async function headedDepartments(user: User) {
  if (user.role === "admin" || !user.employeeId) return [] as Array<{ companyId: number; companyName: string; department: string }>;
  const structure = await companyDepartments();
  const firms = (await env.DB.prepare(`SELECT DISTINCT c.id, c.name FROM employee_companies ec JOIN companies c ON c.id = ec.company_id
    WHERE ec.employee_id = ? AND c.active = 1 ORDER BY c.name`).bind(user.employeeId).all<{ id: number; name: string }>()).results;
  return firms.flatMap((firm: { id: number; name: string }) => structure.headedBy(firm.id, user.employeeId).map((department) => ({ companyId: Number(firm.id), companyName: String(firm.name), department })));
}

type TeamThread = { id: number; type: string; name: string | null; company_id: number | null; department: string | null; archived_at: string | null };
async function teamThread(threadId: number) {
  return env.DB.prepare("SELECT id, type, name, company_id, department, archived_at FROM chat_threads WHERE id = ? AND type = 'team'")
    .bind(threadId).first<TeamThread>();
}
const manages = (thread: TeamThread, headed: Array<{ companyId: number; department: string }>) =>
  headed.some((h) => h.companyId === Number(thread.company_id) && h.department === String(thread.department || "").trim());

// Members picked in the group dialog: active users only, the one making the change always stays in.
async function pickedMembers(user: User, raw: unknown) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((id) => Number.isInteger(id) && id > 0)), user.id];
  const active = (await env.DB.prepare(`SELECT id FROM app_users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: number }>()).results;
  return active.map((row: { id: number }) => Number(row.id));
}

async function chatData(user: User, requestedThreadId = 0, summaryOnly = false) {
  const generalId = await ensureGeneral(user);
  const isAdmin = user.role === "admin";
  // The head of a group's department is always in it — also a head who took the department over after the group was made.
  const headed = summaryOnly ? [] : await headedDepartments(user);
  if (headed.length) {
    const now = new Date().toISOString();
    await env.DB.batch(headed.map((h) => env.DB.prepare(`INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at)
      SELECT id, ?, 0, ? FROM chat_threads WHERE type = 'team' AND company_id = ? AND department = ?`).bind(user.id, now, h.companyId, h.department)));
  }
  // The admin sees every work group, also those they are not a member of (read only, nothing counts as unread there).
  const threads = await env.DB.prepare(`SELECT t.id,t.type,t.company_id,t.department,t.archived_at,
      CASE WHEN t.type='direct' THEN COALESCE(other.name,'Şəxsi söhbət') ELSE t.name END AS name,
      c.name AS company_name, CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS member,
      COALESCE(oe.avatar_key,other.avatar_key) AS avatar_key, other.id AS other_user_id,
      (SELECT CASE WHEN lm.deleted_at IS NOT NULL THEN 'Mesaj silindi' ELSE lm.body END FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message_at,
      CASE WHEN m.user_id IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM chat_messages um WHERE um.thread_id=t.id AND um.id>m.last_read_message_id AND um.sender_user_id!=? AND um.deleted_at IS NULL) END AS unread
    FROM chat_threads t LEFT JOIN chat_members m ON m.thread_id=t.id AND m.user_id=?
    LEFT JOIN companies c ON c.id=t.company_id
    LEFT JOIN chat_members om ON om.thread_id=t.id AND om.user_id!=? AND t.type='direct'
    LEFT JOIN app_users other ON other.id=om.user_id
    LEFT JOIN employees oe ON oe.id=other.employee_id
    WHERE m.user_id IS NOT NULL OR (?=1 AND t.type='team')
    ORDER BY CASE WHEN t.id=? THEN 0 ELSE 1 END,last_message_at DESC,t.id DESC`)
    .bind(user.id, user.id, user.id, isAdmin ? 1 : 0, generalId).all();
  const totalUnread = threads.results.reduce((sum: number, item: any) => sum + Number(item.unread || 0), 0);
  if (summaryOnly) {
    // The newest message waiting for this user (Versiya 2.73): the page shows a notification and plays a sound for it.
    const latest = totalUnread ? await env.DB.prepare(`SELECT msg.id, msg.thread_id, msg.body, msg.attachment_key, u.name AS sender_name, COALESCE(e.avatar_key,u.avatar_key) AS sender_avatar_key
      FROM chat_messages msg JOIN chat_members m ON m.thread_id = msg.thread_id AND m.user_id = ?
      JOIN app_users u ON u.id = msg.sender_user_id LEFT JOIN employees e ON e.id = u.employee_id
      WHERE msg.id > m.last_read_message_id AND msg.sender_user_id != ? AND msg.deleted_at IS NULL ORDER BY msg.id DESC LIMIT 1`).bind(user.id, user.id).first<Record<string, unknown>>() : null;
    const thread = latest ? (threads.results as Array<{ id: number; name: string; type: string; unread: number }>).find((t) => Number(t.id) === Number(latest.thread_id)) : null;
    return { totalUnread, latest: latest && thread ? {
      id: Number(latest.id), threadId: Number(latest.thread_id), threadName: String(thread.name || ""), threadType: String(thread.type || ""),
      senderName: String(latest.sender_name || ""), senderAvatar: (latest.sender_avatar_key as string | null) ?? null,
      text: latest.body ? String(latest.body).slice(0, 140) : latest.attachment_key ? "📎 Fayl" : "", unread: Number(thread.unread || 0),
    } : null };
  }
  const users = await env.DB.prepare(`SELECT u.id,u.name,u.email,COALESCE(e.avatar_key,u.avatar_key) AS avatar_key FROM app_users u
    LEFT JOIN employees e ON e.id=u.employee_id
    WHERE u.active=1 AND u.id!=? ORDER BY u.name`).bind(user.id).all();
  const requested = requestedThreadId ? (threads.results as Array<{ id: number }>).find((t) => Number(t.id) === requestedThreadId) : null;
  // A thread the user can no longer open (e.g. removed from a group) falls back to the general chat.
  const threadId = Number(requested?.id || generalId);
  const selectedThread = threads.results.find((t: any) => Number(t.id) === threadId) as { type: string; member: number } | undefined;
  if (!selectedThread) throw new Error("Bu söhbətə giriş icazəniz yoxdur.");
  const messages = await env.DB.prepare(`SELECT m.*,u.name AS sender_name,COALESCE(e.avatar_key,u.avatar_key) AS sender_avatar_key FROM chat_messages m
    JOIN app_users u ON u.id=m.sender_user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE m.thread_id=? ORDER BY m.id ASC LIMIT 300`).bind(threadId).all();
  // Up to which message someone else has read this conversation: ✓✓ in a direct one, and (Versiya 3.11) a message up to here can
  // no longer be deleted — in a group as soon as at least one member has read it.
  const other = await env.DB.prepare("SELECT COALESCE(MAX(last_read_message_id),0) AS id FROM chat_members WHERE thread_id=? AND user_id!=?")
    .bind(threadId, user.id).first<{ id: number }>();
  const othersReadUpTo = other?.id || 0;
  const readUpTo = selectedThread.type === "direct" ? othersReadUpTo : 0;
  // A work group: its members and whether this user manages it (the head of its department).
  let group: { members: Array<{ id: number; name: string }>; canManage: boolean } | null = null;
  if (selectedThread.type === "team") {
    const members = (await env.DB.prepare(`SELECT u.id, u.name FROM chat_members cm JOIN app_users u ON u.id = cm.user_id
      WHERE cm.thread_id = ? ORDER BY u.name`).bind(threadId).all<{ id: number; name: string }>()).results;
    const team = await teamThread(threadId);
    group = { members: members.map((m: { id: number; name: string }) => ({ id: Number(m.id), name: String(m.name) })), canManage: Boolean(team && manages(team, headed)) };
  }
  return { threads: threads.results, users: users.results, messages: messages.results, selectedThreadId: threadId, totalUnread, readUpTo, othersReadUpTo, group, groupDepartments: headed };
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "chat");
    const params = new URL(request.url).searchParams;
    return Response.json(await chatData(user, Number(params.get("threadId") || 0), params.get("summary") === "1"));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Çat açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "chat");
    const body = await request.json();
    await ensureGeneral(user);
    if (body.action === "direct") {
      const targetId = Number(body.userId);
      const target = await env.DB.prepare("SELECT id FROM app_users WHERE id=? AND active=1").bind(targetId).first();
      if (!target || targetId === user.id) return Response.json({ error: "İstifadəçi seçimi yanlışdır." }, { status: 400 });
      const directKey = [user.id, targetId].sort((a,b) => a-b).join(":");
      await env.DB.prepare("INSERT OR IGNORE INTO chat_threads (type,direct_key,created_by,created_at) VALUES ('direct',?,?,?)")
        .bind(directKey, user.id, new Date().toISOString()).run();
      const thread = await env.DB.prepare("SELECT id FROM chat_threads WHERE direct_key=?").bind(directKey).first<{ id:number }>();
      if (!thread) throw new Error("Söhbət yaradıla bilmədi.");
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at) VALUES (?,?,0,?)").bind(thread.id,user.id,now),
        env.DB.prepare("INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at) VALUES (?,?,0,?)").bind(thread.id,targetId,now),
      ]);
      return Response.json(await chatData(user, thread.id));
    }
    // Versiya 3.53: a department head (the director too) makes a work group of any users; it belongs to the chosen department.
    if (body.action === "createGroup") {
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return Response.json({ error: "Qrupun adını yazın." }, { status: 400 });
      const headed = await headedDepartments(user);
      const owner = headed.find((h) => h.companyId === Number(body.companyId) && h.department === String(body.department || "").trim());
      if (!owner) return Response.json({ error: "Qrupu yalnız şöbə rəhbəri öz şöbəsi adından yarada bilər." }, { status: 403 });
      const members = await pickedMembers(user, body.memberIds);
      if (members.length < 2) return Response.json({ error: "Qrupa ən azı bir üzv seçin." }, { status: 400 });
      const now = new Date().toISOString();
      const result = await env.DB.prepare("INSERT INTO chat_threads (type,name,company_id,department,created_by,created_at) VALUES ('team',?,?,?,?,?)")
        .bind(name, owner.companyId, owner.department, user.id, now).run();
      const createdId = Number((result as unknown as { meta: { last_row_id: number } }).meta.last_row_id);
      if (!createdId) throw new Error("Qrup yaradıla bilmədi.");
      await env.DB.batch(members.map((id) => env.DB.prepare("INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at) VALUES (?,?,0,?)").bind(createdId, id, now)));
      await logAudit(user, "Çat qrupu yaradıldı", "chat", `${name} (${owner.companyName} · ${owner.department})`);
      return Response.json(await chatData(user, createdId));
    }
    // Rename, change members, close or reopen — only the current head of the group's department.
    if (body.action === "updateGroup" || body.action === "archiveGroup") {
      const threadId = Number(body.threadId);
      const team = await teamThread(threadId);
      if (!team) return Response.json({ error: "Qrup tapılmadı." }, { status: 404 });
      if (!manages(team, await headedDepartments(user))) return Response.json({ error: "Qrupu yalnız onun şöbəsinin rəhbəri idarə edir." }, { status: 403 });
      if (body.action === "archiveGroup") {
        const archived = Boolean(body.archived);
        await env.DB.prepare("UPDATE chat_threads SET archived_at = ? WHERE id = ?").bind(archived ? new Date().toISOString() : null, threadId).run();
        await logAudit(user, archived ? "Çat qrupu bağlandı" : "Çat qrupu yenidən açıldı", "chat", team.name);
        return Response.json(await chatData(user, threadId));
      }
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return Response.json({ error: "Qrupun adını yazın." }, { status: 400 });
      const members = await pickedMembers(user, body.memberIds);
      if (members.length < 2) return Response.json({ error: "Qrupda ən azı bir üzv qalmalıdır." }, { status: 400 });
      const now = new Date().toISOString();
      // A removed member loses the group entirely (old messages too); someone added sees its whole history.
      await env.DB.batch([
        env.DB.prepare("UPDATE chat_threads SET name = ? WHERE id = ?").bind(name, threadId),
        env.DB.prepare(`DELETE FROM chat_members WHERE thread_id = ? AND user_id NOT IN (${members.map(() => "?").join(",")})`).bind(threadId, ...members),
        ...members.map((id) => env.DB.prepare("INSERT OR IGNORE INTO chat_members (thread_id,user_id,last_read_message_id,joined_at) VALUES (?,?,0,?)").bind(threadId, id, now)),
      ]);
      await logAudit(user, "Çat qrupu dəyişdirildi", "chat", name);
      return Response.json(await chatData(user, threadId));
    }
    if (body.action === "send") {
      const threadId = Number(body.threadId);
      if (!await isMember(threadId, user.id)) return Response.json({ error: "Bu söhbətə giriş icazəniz yoxdur." }, { status: 403 });
      const closed = await env.DB.prepare("SELECT archived_at FROM chat_threads WHERE id=?").bind(threadId).first<{ archived_at: string | null }>();
      if (closed?.archived_at) return Response.json({ error: "Qrup bağlanıb — yazmaq olmur." }, { status: 400 });
      const message = String(body.message || "").trim();
      if (!message && !body.attachmentKey) return Response.json({ error: "Mesaj və ya fayl əlavə edin." }, { status: 400 });
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO chat_messages
        (thread_id,sender_user_id,body,attachment_key,attachment_name,attachment_size,attachment_type,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(threadId,user.id,message||null,body.attachmentKey||null,body.attachmentName||null,body.attachmentSize||null,body.attachmentType||null,now).run();
      const last = await env.DB.prepare("SELECT MAX(id) AS id FROM chat_messages WHERE thread_id=?").bind(threadId).first<{id:number}>();
      await env.DB.prepare("UPDATE chat_members SET last_read_message_id=? WHERE thread_id=? AND user_id=?").bind(last?.id||0,threadId,user.id).run();
      return Response.json(await chatData(user, threadId));
    }
    // Versiya 3.11: only the sender deletes, and only while no one else has read the message (the admin too — only their own).
    if (body.action === "delete") {
      const messageId = Number(body.messageId);
      const target = await env.DB.prepare("SELECT thread_id, sender_user_id, attachment_key, deleted_at FROM chat_messages WHERE id=?")
        .bind(messageId).first<{ thread_id: number; sender_user_id: number; attachment_key: string | null; deleted_at: string | null }>();
      if (!target || !await isMember(Number(target.thread_id), user.id)) return Response.json({ error: "Mesaj tapılmadı." }, { status: 404 });
      if (Number(target.sender_user_id) !== user.id) return Response.json({ error: "Yalnız öz mesajınızı silə bilərsiniz." }, { status: 403 });
      if (target.deleted_at) return Response.json({ error: "Mesaj artıq silinib." }, { status: 400 });
      const result = await env.DB.prepare(`UPDATE chat_messages SET body=NULL, attachment_key=NULL, attachment_name=NULL, attachment_size=NULL, attachment_type=NULL, deleted_at=?
        WHERE id=? AND sender_user_id=? AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM chat_members cm WHERE cm.thread_id=chat_messages.thread_id AND cm.user_id!=? AND cm.last_read_message_id>=chat_messages.id)`)
        .bind(new Date().toISOString(), messageId, user.id, user.id).run();
      if (!result.meta?.changes) return Response.json({ error: "Mesaj artıq oxunub — silmək olmaz." }, { status: 400 });
      if (target.attachment_key && env.FILES) await env.FILES.delete(target.attachment_key);
      const thread = await env.DB.prepare("SELECT type, name FROM chat_threads WHERE id=?").bind(target.thread_id).first<{ type: string; name: string | null }>();
      await logAudit(user, "Çat mesajı silindi", "chat", thread?.type === "group" ? "Ümumi işçi qrupu" : thread?.type === "team" ? `Qrup: ${thread.name}` : "Şəxsi söhbət");
      return Response.json(await chatData(user, Number(target.thread_id)));
    }
    return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Mesaj göndərilmədi." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "chat");
    const body = await request.json();
    const threadId = Number(body.threadId);
    // The admin reading a group they are not in leaves nothing to mark.
    if (!await isMember(threadId,user.id)) return Response.json({ ok:true });
    const last = await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE thread_id=?").bind(threadId).first<{id:number}>();
    await env.DB.prepare("UPDATE chat_members SET last_read_message_id=? WHERE thread_id=? AND user_id=?").bind(last?.id||0,threadId,user.id).run();
    return Response.json({ ok:true });
  } catch (error) { return authError(error) || Response.json({ error: "Oxunma vəziyyəti yenilənmədi." }, { status: 500 }); }
}
