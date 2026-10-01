import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import { actionKey, deniedFromStored, parseStoredPermissions, type SectionAction, type SectionKey } from "@/lib/permission-model";

// The keys, defaults and the stored format live in lib/permission-model.ts (the page uses the same rules).
export { SECTION_KEYS, OPT_IN_SECTIONS, LEVELED_SECTIONS, type SectionKey, type SectionAction } from "@/lib/permission-model";

export function parseHiddenSections(raw: unknown): string[] {
  return parseStoredPermissions(raw);
}

// Everything the user may NOT do: closed sections ("chat") and denied rights ("documents.outgoing:add"). The admin may do everything.
export async function hiddenSections(user: SessionUser): Promise<Set<string>> {
  if (user.role === "admin") return new Set();
  if (!user.employeeId) return deniedFromStored([]);
  try {
    const row = await env.DB.prepare("SELECT hidden_sections FROM employees WHERE id = ?").bind(user.employeeId).first<{ hidden_sections: string | null }>();
    return deniedFromStored(parseStoredPermissions(row?.hidden_sections));
  } catch {
    // The column is added by the catalog schema; until then only the defaults apply.
    return deniedFromStored([]);
  }
}

// Menus only hide what a user may not open; this is the actual lock, so a hidden section's API answers 403 as well.
export async function requireSection<U extends SessionUser>(user: U, key: SectionKey): Promise<U> {
  if ((await hiddenSections(user)).has(key)) throw new Error("FORBIDDEN");
  return user;
}

// One right of a leveled section (Baxış, Əlavə et, Dəyişiklik et, Sil).
export async function requireAction<U extends SessionUser>(user: U, section: SectionKey, action: SectionAction): Promise<U> {
  const denied = await hiddenSections(user);
  if (denied.has(section) || denied.has(actionKey(section, action))) throw new Error("FORBIDDEN");
  return user;
}

// Any one of several rights (e.g. a customer card created while adding or editing an HR card).
export async function requireAnyAction<U extends SessionUser>(user: U, section: SectionKey, actions: SectionAction[]): Promise<U> {
  const denied = await hiddenSections(user);
  if (denied.has(section) || actions.every((action) => denied.has(actionKey(section, action)))) throw new Error("FORBIDDEN");
  return user;
}

export async function sectionRights(user: SessionUser, section: SectionKey) {
  const denied = await hiddenSections(user);
  const has = (action: SectionAction) => !denied.has(section) && !denied.has(actionKey(section, action));
  return { view: has("view"), add: has("add"), edit: has("edit"), delete: has("delete") };
}
