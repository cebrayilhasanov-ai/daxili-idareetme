import { env } from "@/lib/runtime";

let auditSchemaReady = false;
async function ensureAuditSchema() {
  if (auditSchemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    actor_user_id INTEGER,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_label TEXT,
    created_at TEXT NOT NULL
  )`).run();
  auditSchemaReady = true;
}

export async function logAudit(actor: { id: number; name: string } | null, action: string, targetType: string, targetLabel?: string | null) {
  try {
    await ensureAuditSchema();
    await env.DB.prepare(`INSERT INTO audit_log (actor_user_id, actor_name, action, target_type, target_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(actor?.id ?? null, actor?.name || "Naməlum", action, targetType, targetLabel || null, new Date().toISOString()).run();
  } catch {
    // Audit logging must never block the primary action.
  }
}

export async function listAuditLog(limit = 200) {
  await ensureAuditSchema();
  return (await env.DB.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").bind(limit).all()).results;
}
