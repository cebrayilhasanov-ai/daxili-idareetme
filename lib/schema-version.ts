import { env } from "@/lib/runtime";

// Versiya 3.50: the table checks (CREATE TABLE IF NOT EXISTS, PRAGMA table_info, ALTER TABLE ...) of a module used to run in full
// on every cold start of the Worker — dozens of queries before the request itself. On the free plan that sometimes stopped the
// request half-way and Cloudflare answered with its own HTML page ("Unexpected token '<' ... is not valid JSON" on the screen).
// Now a module writes the version of its schema to app_settings once its checks have run, and later cold starts only read it.
// Whoever adds a table, column or one-time migration to a module MUST raise that module's version, or the change never runs.
export async function schemaIsCurrent(name: string, version: string) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`schema:${name}`).first<{ value: string | null }>();
    return row?.value === version;
  } catch {
    // A new database has no app_settings yet — the checks run and create it.
    return false;
  }
}

export async function markSchemaCurrent(name: string, version: string) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").bind(`schema:${name}`, version).run();
}
