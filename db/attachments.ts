import { env } from "@/lib/runtime";

// Versiya 2.104: several files (up to 10) wherever one file used to be — a personal work and its steps, a task's steps, the
// file a task comes with and the files it is submitted with, a request. All of them live in one table; the old single-file
// columns of each table keep a copy of the FIRST file, so everything that only asks "is there a file" keeps working. Files of
// the server-folder documents (Çıxan / Daxil olan sənədlər) and templates are not here — they stay one file each.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

export type FileRef = { key: string; name: string; size: number; type: string };
export type AttachmentKind = "personal_work" | "personal_work_item" | "task" | "task_submission" | "task_item" | "request";
export const MAX_FILES = 10;

// Where each kind's first file is mirrored: table and column prefix.
const MIRROR: Record<AttachmentKind, [string, string]> = {
  personal_work: ["personal_works", "attachment"],
  personal_work_item: ["personal_work_checklist_items", "attachment"],
  task: ["tasks", "attachment"],
  task_submission: ["tasks", "submission_attachment"],
  task_item: ["task_checklist_items", "attachment"],
  request: ["work_requests", "attachment"],
};

let ready = false;
export async function ensureAttachmentSchema() {
  if (ready) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    file_key TEXT NOT NULL,
    name TEXT,
    size INTEGER,
    type TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`).run();
  await db().prepare("CREATE INDEX IF NOT EXISTS attachments_owner ON attachments (owner_kind, owner_id)").run();
  await db().prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT)").run();
  // Once: the files kept so far in the single-file columns become each owner's first file.
  if (!(await db().prepare("SELECT 1 AS ok FROM app_settings WHERE key = 'attachments_migrated'").first())) {
    const now = new Date().toISOString();
    for (const [kind, [table, prefix]] of Object.entries(MIRROR)) {
      const exists = await db().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first();
      if (!exists) continue;
      const columns = (await db().prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name);
      if (!columns.includes(`${prefix}_key`)) continue;
      await db().prepare(`INSERT INTO attachments (owner_kind, owner_id, file_key, name, size, type, position, created_at)
        SELECT ?, id, ${prefix}_key, ${prefix}_name, ${prefix}_size, ${columns.includes(`${prefix}_type`) ? `${prefix}_type` : "NULL"}, 0, ? FROM ${table}
        WHERE ${prefix}_key IS NOT NULL AND ${prefix}_key != ''
          AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.owner_kind = ? AND a.owner_id = ${table}.id)`).bind(kind, now, kind).run();
    }
    await db().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('attachments_migrated', ?)").bind(now).run();
  }
  ready = true;
}

type Row = { owner_id: number; file_key: string; name: string | null; size: number | null; type: string | null };
const toRef = (r: Row): FileRef => ({ key: r.file_key, name: r.name || "fayl", size: Number(r.size) || 0, type: r.type || "application/octet-stream" });

export async function filesOf(kind: AttachmentKind, id: number): Promise<FileRef[]> {
  return (await filesOfMany(kind, [id])).get(id) ?? [];
}

// The files of many owners at once (for lists), in their order.
export async function filesOfMany(kind: AttachmentKind, ids?: number[]): Promise<Map<number, FileRef[]>> {
  await ensureAttachmentSchema();
  const result = new Map<number, FileRef[]>();
  if (ids && !ids.length) return result;
  // D1 limits the number of bound values, so a long list is read whole and filtered here.
  const rows = (ids && ids.length <= 50
    ? await db().prepare(`SELECT owner_id, file_key, name, size, type FROM attachments WHERE owner_kind = ? AND owner_id IN (${ids.map(() => "?").join(",")}) ORDER BY position, id`).bind(kind, ...ids).all<Row>()
    : await db().prepare("SELECT owner_id, file_key, name, size, type FROM attachments WHERE owner_kind = ? ORDER BY position, id").bind(kind).all<Row>()).results;
  const wanted = ids ? new Set(ids) : null;
  for (const r of rows) {
    if (wanted && !wanted.has(Number(r.owner_id))) continue;
    result.set(Number(r.owner_id), [...(result.get(Number(r.owner_id)) ?? []), toRef(r)]);
  }
  return result;
}

// Adds "files" (and, where asked, other kinds) to rows of a list.
export async function withFiles<T extends Record<string, unknown>, F extends string = "files">(rows: T[], kind: AttachmentKind, field: F = "files" as F, idField = "id"): Promise<Array<T & Record<F, FileRef[]>>> {
  const ids = rows.map((r) => Number(r[idField])).filter(Boolean);
  const map = await filesOfMany(kind, ids);
  return rows.map((r) => ({ ...r, [field]: map.get(Number(r[idField])) ?? [] }) as T & Record<F, FileRef[]>);
}

// Replaces an owner's files with the given list (kept files keep their keys); files left out are deleted from storage.
export async function setFiles(kind: AttachmentKind, id: number, files: FileRef[]) {
  await ensureAttachmentSchema();
  if (files.length > MAX_FILES) throw new Error(`Ən çox ${MAX_FILES} fayl əlavə etmək olar.`);
  const before = await filesOf(kind, id);
  await db().prepare("DELETE FROM attachments WHERE owner_kind = ? AND owner_id = ?").bind(kind, id).run();
  const now = new Date().toISOString();
  for (const [position, f] of files.entries()) {
    await db().prepare("INSERT INTO attachments (owner_kind, owner_id, file_key, name, size, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(kind, id, f.key, f.name, f.size, f.type, position, now).run();
  }
  const [table, prefix] = MIRROR[kind];
  const first = files[0];
  await db().prepare(`UPDATE ${table} SET ${prefix}_key = ?, ${prefix}_name = ?, ${prefix}_size = ?, ${prefix}_type = ? WHERE id = ?`)
    .bind(first?.key ?? null, first?.name ?? null, first?.size ?? null, first?.type ?? null, id).run();
  const kept = new Set(files.map((f) => f.key));
  if (env.FILES) for (const f of before) if (!kept.has(f.key)) await env.FILES.delete(f.key);
  return { before, after: files };
}

// An owner going away takes its files with it.
export async function removeFiles(kind: AttachmentKind, id: number) {
  await ensureAttachmentSchema();
  const files = await filesOf(kind, id);
  await db().prepare("DELETE FROM attachments WHERE owner_kind = ? AND owner_id = ?").bind(kind, id).run();
  if (env.FILES) for (const f of files) await env.FILES.delete(f.key);
}

// Own copies of files (a delegated step's task, an accepted request's task), so deleting either side never orphans the other.
export async function copyFiles(files: FileRef[]): Promise<FileRef[]> {
  const copies: FileRef[] = [];
  if (!env.FILES) return copies;
  for (const f of files) {
    const source = await env.FILES.get(f.key);
    if (!source) continue;
    const key = `${crypto.randomUUID()}-${f.name.replace(/[^\p{L}\p{N}._-]+/gu, "_")}`;
    await env.FILES.put(key, await source.arrayBuffer(), { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata });
    copies.push({ ...f, key });
  }
  return copies;
}

// A list of files sent by the page: { files: [{ key, name, size, type }] }, or the older single attachmentKey/Name/Size/Type.
export function parseFiles(raw: unknown, single?: { key?: unknown; name?: unknown; size?: unknown; type?: unknown }): FileRef[] {
  const list = Array.isArray(raw) ? raw : single?.key ? [single] : [];
  const files = list
    .map((f) => f as { key?: unknown; name?: unknown; size?: unknown; type?: unknown })
    .filter((f) => typeof f?.key === "string" && f.key.trim())
    .map((f) => ({ key: String(f.key), name: String(f.name || "fayl"), size: Number(f.size) || 0, type: String(f.type || "application/octet-stream") }));
  if (files.length > MAX_FILES) throw new Error(`Ən çox ${MAX_FILES} fayl əlavə etmək olar.`);
  return files;
}

export const fileNames = (files: FileRef[]) => files.map((f) => f.name).join(", ");
