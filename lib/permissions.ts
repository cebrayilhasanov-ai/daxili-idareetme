import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import {
  actionKey, deniedFromStored, deniedWithFirms, firmSectionRights, parseCompanyPermissions, parseStoredPermissions,
  type CompanyPermissions, type FirmSection, type SectionAction, type SectionKey,
} from "@/lib/permission-model";

// The keys, defaults and the stored format live in lib/permission-model.ts (the page uses the same rules).
export { SECTION_KEYS, OPT_IN_SECTIONS, LEVELED_SECTIONS, FIRM_SECTIONS, type SectionKey, type SectionAction, type FirmSection } from "@/lib/permission-model";

export function parseHiddenSections(raw: unknown): string[] {
  return parseStoredPermissions(raw);
}

type StoredRights = { stored: string[]; firms: CompanyPermissions | null; companyIds: number[] };

async function storedRights(user: SessionUser): Promise<StoredRights> {
  if (!user.employeeId) return { stored: [], firms: {}, companyIds: [] };
  try {
    const row = await env.DB.prepare("SELECT hidden_sections, company_permissions FROM employees WHERE id = ?").bind(user.employeeId).first<{ hidden_sections: string | null; company_permissions: string | null }>();
    const companyIds = (await env.DB.prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(user.employeeId).all<{ company_id: number }>()).results.map((r) => r.company_id);
    return { stored: parseStoredPermissions(row?.hidden_sections), firms: parseCompanyPermissions(row?.company_permissions), companyIds };
  } catch {
    // The columns are added by the catalog schema; until then the old one-for-all rights apply.
    try {
      const row = await env.DB.prepare("SELECT hidden_sections FROM employees WHERE id = ?").bind(user.employeeId).first<{ hidden_sections: string | null }>();
      return { stored: parseStoredPermissions(row?.hidden_sections), firms: null, companyIds: [] };
    } catch { return { stored: [], firms: null, companyIds: [] }; }
  }
}

// Everything the user may NOT do: closed sections ("chat") and denied rights ("documents.outgoing:add"). The admin may do everything.
// For the firm sections (Versiya 2.99) a section or a right counts as given when any of the user's firms has it; what may be done
// in a particular firm is asked with firmAccess.
export async function hiddenSections(user: SessionUser): Promise<Set<string>> {
  if (user.role === "admin") return new Set();
  const { stored, firms, companyIds } = await storedRights(user);
  return firms ? deniedWithFirms(stored, firms, companyIds) : deniedFromStored(stored);
}

// Menus only hide what a user may not open; this is the actual lock, so a hidden section's API answers 403 as well.
export async function requireSection<U extends SessionUser>(user: U, key: SectionKey): Promise<U> {
  if ((await hiddenSections(user)).has(key)) throw new Error("FORBIDDEN");
  return user;
}

// One right of a leveled section (Baxış, Əlavə et, Dəyişiklik et, Sil) — in a firm section, in at least one firm.
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

// ---------- Per firm (Versiya 2.99) ----------
export type FirmRights = { view: boolean; add: boolean; edit: boolean; delete: boolean; types: Set<string> | null };
export type FirmAccess = {
  admin: boolean;
  // The rights in one firm; types: the document types (lower-case template names) the work there is narrowed to, null = all.
  firm: (companyId: number) => FirmRights;
  // The firms where the right is given (null = every firm, for the admin).
  firms: (action: SectionAction) => number[] | null;
};

const ALL_RIGHTS: FirmRights = { view: true, add: true, edit: true, delete: true, types: null };
export const typeKey = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("az");

export async function firmAccess(user: SessionUser, section: FirmSection): Promise<FirmAccess> {
  if (user.role === "admin") return { admin: true, firm: () => ALL_RIGHTS, firms: () => null };
  const { stored, firms, companyIds } = await storedRights(user);
  const rights = new Map<number, FirmRights>();
  if (firms) {
    // Template ids → names, which is how documents keep their type.
    const ids = [...new Set(companyIds.flatMap((id) => firmSectionRights(firms, id, section).types ?? []))];
    const names = new Map<number, string>();
    if (ids.length) {
      const rows = (await env.DB.prepare(`SELECT id, name FROM document_templates WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: number; name: string }>()).results;
      for (const row of rows) names.set(row.id, typeKey(row.name));
    }
    for (const id of companyIds) {
      const r = firmSectionRights(firms, id, section);
      rights.set(id, { view: r.view, add: r.add, edit: r.edit, delete: r.delete, types: r.types ? new Set(r.types.flatMap((t) => names.get(t) ?? [])) : null });
    }
  } else {
    const denied = deniedFromStored(stored);
    const has = (action: SectionAction) => !denied.has(section) && !denied.has(actionKey(section, action));
    for (const id of companyIds) rights.set(id, { view: has("view"), add: has("add"), edit: has("edit"), delete: has("delete"), types: null });
  }
  const none: FirmRights = { view: false, add: false, edit: false, delete: false, types: null };
  return {
    admin: false,
    firm: (companyId) => rights.get(Number(companyId)) ?? none,
    firms: (action) => [...rights].filter(([, r]) => r[action]).map(([id]) => id),
  };
}

// The firm's rights for a document of the given type: a type outside the firm's narrowed list gets none.
export function rightsForType(rights: FirmRights, documentType: unknown): FirmRights {
  if (!rights.types || rights.types.has(typeKey(documentType))) return rights;
  return { view: false, add: false, edit: false, delete: false, types: rights.types };
}
