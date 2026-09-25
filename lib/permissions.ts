import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";

// Sections the admin can hide per employee ("Giriş icazələri" in the Personal dialog). An employee stores the keys it may NOT
// see (employees.hidden_sections, a JSON array), so everything stays open by default and sections added later start visible.
// "tasks.manager" (tasks given by a manager) is never hidden, otherwise assigned work would disappear.
export const SECTION_KEYS = [
  "dashboard.customers",
  "tasks.requests",
  "tasks.mine",
  "tasks.monthly",
  "tasks.weekly",
  "documents.templates",
  "documents.outgoing",
  "documents.incoming",
  "hr.violations",
  "chat",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function parseHiddenSections(raw: unknown): SectionKey[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((key): key is SectionKey => (SECTION_KEYS as readonly string[]).includes(String(key))))];
}

export async function hiddenSections(user: SessionUser): Promise<Set<SectionKey>> {
  if (user.role === "admin" || !user.employeeId) return new Set();
  try {
    const row = await env.DB.prepare("SELECT hidden_sections FROM employees WHERE id = ?").bind(user.employeeId).first<{ hidden_sections: string | null }>();
    return new Set(parseHiddenSections(row?.hidden_sections));
  } catch {
    // The column is added by the catalog schema; until then nothing is hidden.
    return new Set();
  }
}

// Menus only hide what a user may not open; this is the actual lock, so a hidden section's API answers 403 as well.
export async function requireSection<U extends SessionUser>(user: U, key: SectionKey): Promise<U> {
  if ((await hiddenSections(user)).has(key)) throw new Error("FORBIDDEN");
  return user;
}
