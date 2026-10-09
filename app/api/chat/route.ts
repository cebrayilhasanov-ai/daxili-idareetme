import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

type User = Awaited<ReturnType<typeof requireUser>>;

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// Versiya 3.11: a deleted message keeps its place as "Mesaj silindi" — its text and file are removed.
let chatSchemaReady = false;
async function ensureChatSchema() {
  if (chatSchemaReady) return;
  const columns = await env.DB.prepare("PRAGMA table_info(chat_messages)").all<{ name: string }>();
  if (!columns.results.some((column: { name: string }) => column.name === "deleted_at")) await env.DB.prepare("ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT").run();
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

async function chatData(user: User, requestedThreadId = 0, summaryOnly = false) {
  const generalId = await ensureGeneral(user);
  const threads = await env.DB.prepare(`SELECT t.id,t.type,
      CASE WHEN t.type='group' THEN t.name ELSE COALESCE(other.name,'Şəxsi söhbət') END AS name,
      COALESCE(oe.avatar_key,other.avatar_key) AS avatar_key, other.id AS other_user_id,
      (SELECT CASE WHEN lm.deleted_at IS NOT NULL THEN 'Mesaj silindi' ELSE lm.body END FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages um WHERE um.thread_id=t.id AND um.id>m.last_read_message_id AND um.sender_user_id!=? AND um.deleted_at IS NULL) AS unread
    FROM chat_members m JOIN chat_threads t ON t.id=m.thread_id
    LEFT JOIN chat_members om ON om.thread_id=t.id AND om.user_id!=? AND t.type='direct'
    LEFT JOIN app_users other ON other.id=om.user_id
    LEFT JOIN employees oe ON oe.id=other.employee_id
    WHERE m.user_id=? ORDER BY CASE WHEN t.id=? THEN 0 ELSE 1 END,last_message_at DESC,t.id DESC`)
    .bind(user.id, user.id, user.id, generalId).all();
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
  const threadId = requestedThreadId || Number((threads.results[0] as any)?.id || generalId);
  if (!await isMember(threadId, user.id)) throw new Error("Bu söhbətə giriş icazəniz yoxdur.");
  const messages = await env.DB.prepare(`SELECT m.*,u.name AS sender_name,COALESCE(e.avatar_key,u.avatar_key) AS sender_avatar_key FROM chat_messages m
    JOIN app_users u ON u.id=m.sender_user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE m.thread_id=? ORDER BY m.id ASC LIMIT 300`).bind(threadId).all();
  const selectedThread = threads.results.find((t: any) => Number(t.id) === threadId) as { type: string } | undefined;
  // Up to which message someone else has read this conversation: ✓✓ in a direct one, and (Versiya 3.11) a message up to here can
  // no longer be deleted — in the group as soon as at least one member has read it.
  const other = await env.DB.prepare("SELECT COALESCE(MAX(last_read_message_id),0) AS id FROM chat_members WHERE thread_id=? AND user_id!=?")
    .bind(threadId, user.id).first<{ id: number }>();
  const othersReadUpTo = other?.id || 0;
  const readUpTo = selectedThread?.type === "direct" ? othersReadUpTo : 0;
  return { threads: threads.results, users: users.results, messages: messages.results, selectedThreadId: threadId, totalUnread, readUpTo, othersReadUpTo };
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
    if (body.action === "send") {
      const threadId = Number(body.threadId);
      if (!await isMember(threadId, user.id)) return Response.json({ error: "Bu söhbətə giriş icazəniz yoxdur." }, { status: 403 });
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
      const thread = await env.DB.prepare("SELECT type FROM chat_threads WHERE id=?").bind(target.thread_id).first<{ type: string }>();
      await logAudit(user, "Çat mesajı silindi", "chat", thread?.type === "group" ? "Ümumi işçi qrupu" : "Şəxsi söhbət");
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
    if (!await isMember(threadId,user.id)) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    const last = await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE thread_id=?").bind(threadId).first<{id:number}>();
    await env.DB.prepare("UPDATE chat_members SET last_read_message_id=? WHERE thread_id=? AND user_id=?").bind(last?.id||0,threadId,user.id).run();
    return Response.json({ ok:true });
  } catch (error) { return authError(error) || Response.json({ error: "Oxunma vəziyyəti yenilənmədi." }, { status: 500 }); }
}
