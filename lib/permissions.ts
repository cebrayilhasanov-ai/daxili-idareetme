import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";

// Sections the admin can hide per employee ("Giriş icazələri" in the Personal dialog). An employee stores the keys it may NOT
// see (employees.hidden_sections, a JSON array), so everything stays open by default and sections added later start visible
// (except OPT_IN_SECTIONS below).
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
  "hr.personnel",
  "chat",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

// Sections that start CLOSED (personal ID data, salaries): for these keys the stored list names the ones the admin has
// opened, the reverse of every other key. deniedSections() turns the stored list into the set of sections that are locked.
export const OPT_IN_SECTIONS: readonly SectionKey[] = ["hr.personnel"];
export function deniedSections(stored: SectionKey[]): Set<SectionKey> {
  const denied = new Set(stored.filter((key) => !OPT_IN_SECTIONS.includes(key)));
  for (const key of OPT_IN_SECTIONS) if (!stored.includes(key)) denied.add(key);
  return denied;
}

export function parseHiddenSections(raw: unknown): SectionKey[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((key): key is SectionKey => (SECTION_KEYS as readonly string[]).includes(String(key))))];
}

export async function hiddenSections(user: SessionUser): Promise<Set<SectionKey>> {
  if (user.role === "admin") return new Set();
  if (!user.employeeId) return new Set(OPT_IN_SECTIONS);
  try {
    const row = await env.DB.prepare("SELECT hidden_sections FROM employees WHERE id = ?").bind(user.employeeId).first<{ hidden_sections: string | null }>();
    return deniedSections(parseHiddenSections(row?.hidden_sections));
  } catch {
    // The column is added by the catalog schema; until then only the opt-in sections stay closed.
    return new Set(OPT_IN_SECTIONS);
  }
}

// Menus only hide what a user may not open; this is the actual lock, so a hidden section's API answers 403 as well.
export async function requireSection<U extends SessionUser>(user: U, key: SectionKey): Promise<U> {
  if ((await hiddenSections(user)).has(key)) throw new Error("FORBIDDEN");
  return user;
}
