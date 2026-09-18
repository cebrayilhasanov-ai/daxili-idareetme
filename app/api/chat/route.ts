import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";

type User = Awaited<ReturnType<typeof requireUser>>;

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  return null;
}

async function ensureGeneral(user: User) {
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
      COALESCE(oe.avatar_key,other.avatar_key) AS avatar_key,
      (SELECT body FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM chat_messages lm WHERE lm.thread_id=t.id ORDER BY lm.id DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages um WHERE um.thread_id=t.id AND um.id>m.last_read_message_id AND um.sender_user_id!=?) AS unread
    FROM chat_members m JOIN chat_threads t ON t.id=m.thread_id
    LEFT JOIN chat_members om ON om.thread_id=t.id AND om.user_id!=? AND t.type='direct'
    LEFT JOIN app_users other ON other.id=om.user_id
    LEFT JOIN employees oe ON oe.id=other.employee_id
    WHERE m.user_id=? ORDER BY CASE WHEN t.id=? THEN 0 ELSE 1 END,last_message_at DESC,t.id DESC`)
    .bind(user.id, user.id, user.id, generalId).all();
  const totalUnread = threads.results.reduce((sum, item: any) => sum + Number(item.unread || 0), 0);
  if (summaryOnly) return { totalUnread };
  const users = await env.DB.prepare(`SELECT u.id,u.name,u.email,COALESCE(e.avatar_key,u.avatar_key) AS avatar_key FROM app_users u
    LEFT JOIN employees e ON e.id=u.employee_id
    WHERE u.active=1 AND u.id!=? ORDER BY u.name`).bind(user.id).all();
  const threadId = requestedThreadId || Number((threads.results[0] as any)?.id || generalId);
  if (!await isMember(threadId, user.id)) throw new Error("Bu söhbətə giriş icazəniz yoxdur.");
  const messages = await env.DB.prepare(`SELECT m.*,u.name AS sender_name,COALESCE(e.avatar_key,u.avatar_key) AS sender_avatar_key FROM chat_messages m
    JOIN app_users u ON u.id=m.sender_user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE m.thread_id=? ORDER BY m.id ASC LIMIT 300`).bind(threadId).all();
  const selectedThread = threads.results.find((t: any) => Number(t.id) === threadId) as { type: string } | undefined;
  let readUpTo = 0;
  if (selectedThread?.type === "direct") {
    const other = await env.DB.prepare("SELECT COALESCE(MAX(last_read_message_id),0) AS id FROM chat_members WHERE thread_id=? AND user_id!=?")
      .bind(threadId, user.id).first<{ id: number }>();
    readUpTo = other?.id || 0;
  }
  return { threads: threads.results, users: users.results, messages: messages.results, selectedThreadId: threadId, totalUnread, readUpTo };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    return Response.json(await chatData(user, Number(params.get("threadId") || 0), params.get("summary") === "1"));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Çat açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
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
    return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Mesaj göndərilmədi." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const threadId = Number(body.threadId);
    if (!await isMember(threadId,user.id)) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    const last = await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE thread_id=?").bind(threadId).first<{id:number}>();
    await env.DB.prepare("UPDATE chat_members SET last_read_message_id=? WHERE thread_id=? AND user_id=?").bind(last?.id||0,threadId,user.id).run();
    return Response.json({ ok:true });
  } catch (error) { return authError(error) || Response.json({ error: "Oxunma vəziyyəti yenilənmədi." }, { status: 500 }); }
}
