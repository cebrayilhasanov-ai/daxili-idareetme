// "Giriş icazələri" (the Personal dialog) — the pure part, shared by the server (lib/permissions.ts) and the page.
//
// An employee stores a JSON list (employees.hidden_sections) of keys that FLIP the default:
// - a plain section key ("chat") hides an open-by-default section, or opens an opt-in one (OPT_IN_SECTIONS);
// - since Versiya 2.62 the sections in LEVELED_SECTIONS have four separate rights — Baxış, Əlavə et, Dəyişiklik et, Sil — and
//   "<section>:<action>" flips that one right from its default. Older lists that name the whole section keep working: the
//   section is then fully closed (or, for an opt-in section, fully open). Saving from the dialog writes only action keys.
// Defaults keep what users could do before 2.62, so nobody gains or loses anything until the admin changes it.
// Any of Əlavə et / Dəyişiklik et / Sil implies Baxış.
// "tasks.manager" (tasks given by a manager) is never hidden, otherwise assigned work would disappear.
export const SECTION_KEYS = [
  "dashboard.customers",
  "tasks.requests",
  "tasks.mine",
  "tasks.fixed",
  "documents.templates",
  "documents.outgoing",
  "documents.incoming",
  "hr.violations",
  "hr.personnel",
  "hr.orders",
  "chat",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const ACTIONS = ["view", "add", "edit", "delete"] as const;
export type SectionAction = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<SectionAction, string> = { view: "Baxış", add: "Əlavə et", edit: "Dəyişiklik et", delete: "Sil" };

export const LEVELED_SECTIONS: readonly SectionKey[] = [
  "dashboard.customers", "tasks.requests", "documents.outgoing", "documents.incoming", "hr.violations", "hr.personnel", "hr.orders",
];
// Sections that start CLOSED (personal ID data, salaries).
export const OPT_IN_SECTIONS: readonly SectionKey[] = ["hr.personnel", "hr.orders"];
// Rights a leveled section does NOT give by default (before 2.62 customers were edited/deleted and violations recorded only by the admin).
const DEFAULT_DENIED: Partial<Record<SectionKey, readonly SectionAction[]>> = {
  "dashboard.customers": ["edit", "delete"],
  "hr.violations": ["add", "edit", "delete"],
  "hr.personnel": ACTIONS,
  "hr.orders": ACTIONS,
};

export const actionKey = (section: string, action: SectionAction) => `${section}:${action}`;
const isLeveled = (section: string) => (LEVELED_SECTIONS as readonly string[]).includes(section);
const isOptIn = (section: string) => (OPT_IN_SECTIONS as readonly string[]).includes(section);
const deniedByDefault = (section: string, action: SectionAction) => Boolean(DEFAULT_DENIED[section as SectionKey]?.includes(action));

// Versiya 2.93: "Aylıq" and "Həftəlik sabit işlər" became one "Sabit işlər" (tasks.fixed). Old lists keep their keys: the new
// section is closed only when both old ones were, so nobody loses access to works they could mark before.
const LEGACY_FIXED = ["tasks.monthly", "tasks.weekly"];
const VALID_KEYS = new Set<string>([...SECTION_KEYS, ...LEGACY_FIXED, ...LEVELED_SECTIONS.flatMap((s) => ACTIONS.map((a) => actionKey(s, a)))]);

export function parseStoredPermissions(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((key) => VALID_KEYS.has(key)))];
}

// The stored list → everything the employee may NOT do: section keys (the section is closed — no Baxış) and "<section>:<action>" keys.
export function deniedFromStored(stored: string[]): Set<string> {
  const flips = new Set(stored);
  const denied = new Set<string>();
  for (const section of SECTION_KEYS) {
    if (!isLeveled(section)) {
      const flipped = flips.has(section) || (section === "tasks.fixed" && LEGACY_FIXED.every((key) => flips.has(key)));
      if (isOptIn(section) ? !flipped : flipped) denied.add(section);
      continue;
    }
    const whole = flips.has(section) ? (isOptIn(section) ? "open" : "closed") : null;
    const deniedAction = (action: SectionAction) => whole ? whole === "closed" : deniedByDefault(section, action) !== flips.has(actionKey(section, action));
    const granted = new Set(ACTIONS.filter((a) => !deniedAction(a)));
    if (granted.has("add") || granted.has("edit") || granted.has("delete")) granted.add("view");
    for (const action of ACTIONS) if (!granted.has(action)) denied.add(actionKey(section, action));
    if (!granted.has("view")) denied.add(section);
  }
  return denied;
}

// ---------- Per firm (Versiya 2.99) ----------
// The sections that work inside a firm get their rights per firm: employees.company_permissions holds, for each firm the user
// works in, the rights granted in each of these sections — { "<companyId>": { "<section>": { actions: [...], types?: [templateId] } } }.
// Nothing is flipped from a default here: a firm or a section that is not listed is closed (a firm newly added to a user starts
// fully closed). In Çıxan / Daxil olan sənədlər "types" narrows the registrar's work in that firm to the listed document types
// (templates of the firm); without it every type is covered. The other sections (Ümumi) stay in hidden_sections as before.
export const FIRM_SECTIONS = ["tasks.requests", "documents.incoming", "documents.outgoing", "hr.personnel", "hr.orders", "hr.violations"] as const;
export type FirmSection = (typeof FIRM_SECTIONS)[number];
export const TYPED_SECTIONS: readonly FirmSection[] = ["documents.outgoing", "documents.incoming"];
export const isFirmSection = (section: string): section is FirmSection => (FIRM_SECTIONS as readonly string[]).includes(section);
export type FirmSectionRights = { actions: SectionAction[]; types?: number[] };
export type CompanyPermissions = Record<string, Partial<Record<FirmSection, FirmSectionRights>>>;

export function parseCompanyPermissions(raw: unknown): CompanyPermissions {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { value = null; }
  }
  const result: CompanyPermissions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [companyId, sections] of Object.entries(value as Record<string, unknown>)) {
    if (!(Number(companyId) > 0) || !sections || typeof sections !== "object") continue;
    const firm: Partial<Record<FirmSection, FirmSectionRights>> = {};
    for (const section of FIRM_SECTIONS) {
      const entry = (sections as Record<string, unknown>)[section] as { actions?: unknown; types?: unknown } | undefined;
      const actions = ACTIONS.filter((a) => Array.isArray(entry?.actions) && entry.actions.includes(a));
      // Any of Əlavə et / Dəyişiklik et / Sil implies Baxış.
      if (actions.length && !actions.includes("view")) actions.unshift("view");
      if (!actions.length) continue;
      const types = TYPED_SECTIONS.includes(section) && Array.isArray(entry?.types) ? [...new Set(entry.types.map(Number).filter((id) => id > 0))] : undefined;
      firm[section] = types ? { actions, types } : { actions };
    }
    if (Object.keys(firm).length) result[String(Number(companyId))] = firm;
  }
  return result;
}

// The rights of one firm section; types null = every document type.
export function firmSectionRights(permissions: CompanyPermissions, companyId: number, section: FirmSection) {
  const entry = permissions[String(companyId)]?.[section];
  const has = (action: SectionAction) => Boolean(entry?.actions.includes(action));
  return { view: has("view"), add: has("add"), edit: has("edit"), delete: has("delete"), types: entry?.types ?? null };
}

// What the old (pre-2.99) one-for-all rights meant, written out for each of the user's firms — the migration, so nobody's rights change.
export function companyPermissionsFromStored(stored: string[], companyIds: number[]): CompanyPermissions {
  const denied = deniedFromStored(stored);
  const firm: Partial<Record<FirmSection, FirmSectionRights>> = {};
  for (const section of FIRM_SECTIONS) {
    const actions = ACTIONS.filter((a) => !denied.has(section) && !denied.has(actionKey(section, a)));
    if (actions.length) firm[section] = { actions };
  }
  return Object.fromEntries(companyIds.map((id) => [String(id), structuredClone(firm)]));
}

// Menus and the coarse locks: a firm section counts as open (and a right as given) when any of the user's firms has it.
export function deniedWithFirms(stored: string[], permissions: CompanyPermissions, companyIds: number[]): Set<string> {
  const denied = deniedFromStored(stored);
  for (const section of FIRM_SECTIONS) {
    denied.delete(section);
    for (const action of ACTIONS) {
      if (companyIds.some((id) => firmSectionRights(permissions, id, section)[action])) denied.delete(actionKey(section, action));
      else denied.add(actionKey(section, action));
    }
    if (denied.has(actionKey(section, "view"))) denied.add(section);
  }
  return denied;
}

// The reverse, for saving the dialog: only the keys that differ from the defaults.
export function storedFromDenied(denied: Set<string>): string[] {
  const stored: string[] = [];
  for (const section of SECTION_KEYS) {
    if (!isLeveled(section)) {
      if (isOptIn(section) ? !denied.has(section) : denied.has(section)) stored.push(section);
      continue;
    }
    for (const action of ACTIONS) {
      const isDenied = denied.has(section) || denied.has(actionKey(section, action));
      if (isDenied !== deniedByDefault(section, action)) stored.push(actionKey(section, action));
    }
  }
  return stored;
}
