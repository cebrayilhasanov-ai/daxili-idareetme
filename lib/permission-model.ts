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
  "documents.internal",
  "hr.violations",
  "hr.personnel",
  "hr.orders",
  "hr.payroll",
  "tasks.reports",
  "documents.reports",
  "hr.reports",
  "chat",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const ACTIONS = ["view", "add", "edit", "delete"] as const;
export type SectionAction = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<SectionAction, string> = { view: "Baxış", add: "Əlavə et", edit: "Dəyişiklik et", delete: "Sil" };

export const LEVELED_SECTIONS: readonly SectionKey[] = [
  "dashboard.customers", "tasks.requests", "documents.outgoing", "documents.incoming", "documents.internal", "hr.violations", "hr.personnel", "hr.orders", "hr.payroll",
];
// Sections that start CLOSED (personal ID data, salaries; from Versiya 3.41 the Hesabatlar of Tapşırıqlar, Sənədlər and Kadrlar;
// from 3.51 Şirkətdaxili sənədlər — a new register, so nobody gets it until the admin opens it; from 3.54 Əməkhaqqı cədvəlləri).
export const OPT_IN_SECTIONS: readonly SectionKey[] = ["hr.personnel", "hr.orders", "hr.payroll", "tasks.reports", "documents.reports", "hr.reports", "documents.internal"];
// Rights a leveled section does NOT give by default (before 2.62 customers were edited/deleted and violations recorded only by the admin).
const DEFAULT_DENIED: Partial<Record<SectionKey, readonly SectionAction[]>> = {
  "dashboard.customers": ["edit", "delete"],
  "hr.violations": ["add", "edit", "delete"],
  "hr.personnel": ACTIONS,
  "hr.orders": ACTIONS,
  "hr.payroll": ACTIONS,
  "documents.internal": ACTIONS,
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
// (templates of the firm); without it every type is covered.
// Since Versiya 3.00 every section is given per firm (the dialog lists the firms one under another, no "Ümumi" part): Şəxsi işlərim,
// Sabit işlər and Çat are plain on/off (stored as ["view"]); Müştərilər and Çat do not belong to a firm and are open when any firm opens them.
// Versiya 3.41: Hesabatlar under Tapşırıqlar, Sənədlər and Kadrlar — plain on/off per firm, closed until the admin opens them.
export const FIRM_SECTIONS = ["tasks.requests", "tasks.mine", "tasks.fixed", "tasks.reports", "documents.incoming", "documents.outgoing", "documents.internal", "dashboard.customers", "documents.reports", "hr.personnel", "hr.orders", "hr.payroll", "hr.violations", "hr.reports", "chat"] as const;
export type FirmSection = (typeof FIRM_SECTIONS)[number];
export const TYPED_SECTIONS: readonly FirmSection[] = ["documents.outgoing", "documents.incoming", "documents.internal"];
export const isFirmSection = (section: string): section is FirmSection => (FIRM_SECTIONS as readonly string[]).includes(section);
// Versiya 3.19: inside some sections each part has its own rights — the headings of the Personallar card (and, from 3.20, the
// tabs of Əmrlər). "parts" lists, per part, the rights given there; without "parts" every part has what the section's rights
// gave there before (legacyPartActions — that is how all stored rights read, so nothing changed for anyone on rollout).
// A part missing from the list is closed.
export type SectionPart = { key: string; label: string; actions: readonly SectionAction[] };
export type SectionPartGroup = { key: string; label: string; parts: SectionPart[] };
const FIXED: readonly SectionAction[] = ["view", "edit"];
const VIEW_ONLY: readonly SectionAction[] = ["view"];
export const SECTION_PARTS: Partial<Record<SectionKey, SectionPartGroup[]>> = {
  "hr.personnel": [
    { key: "card", label: "Şəxsi kart", parts: [
      { key: "personal", label: "Şəxsi məlumatlar", actions: FIXED },
      { key: "emergency", label: "Təcili əlaqə şəxsi", actions: FIXED },
      { key: "idcard", label: "Şəxsiyyət vəsiqəsi", actions: FIXED },
      { key: "workplace", label: "İş yeri", actions: FIXED },
      { key: "priorJobs", label: "Əvvəlki iş yerləri", actions: ACTIONS },
      { key: "contract", label: "Əmək müqaviləsi", actions: FIXED },
      { key: "termination", label: "İşdən çıxma", actions: VIEW_ONLY },
    ] },
    { key: "family", label: "Ailə və təhsil", parts: [
      { key: "family", label: "Ailə üzvləri", actions: ACTIONS },
      { key: "education", label: "Təhsil", actions: ACTIONS },
    ] },
    { key: "leaves", label: "Məzuniyyətlər", parts: [
      { key: "entitlement", label: "Məzuniyyət hüququ", actions: FIXED },
      { key: "leaves", label: "Qeydə alınmış məzuniyyətlər", actions: VIEW_ONLY },
      { key: "sick", label: "Xəstəlik vərəqəsi", actions: ACTIONS },
    ] },
    { key: "salary", label: "Əmək haqqı", parts: [{ key: "salary", label: "Əmək haqqı", actions: ACTIONS }] },
    { key: "settlement", label: "Son hesablaşma", parts: [{ key: "settlement", label: "Son hesablaşma", actions: VIEW_ONLY }] },
  ],
  // Versiya 3.20: the tabs of Əmrlər (Sil is cancelling an order); the section itself then only opens the menu.
  "hr.orders": [
    { key: "leave", label: "Məzuniyyət əmrləri", parts: [{ key: "leave", label: "Məzuniyyət əmrləri", actions: ACTIONS }] },
    { key: "termination", label: "İşdən çıxma əmrləri", parts: [{ key: "termination", label: "İşdən çıxma əmrləri", actions: ACTIONS }] },
    { key: "other", label: "Digər əmrlər", parts: [{ key: "other", label: "Digər əmrlər", actions: ACTIONS }] },
    { key: "settings", label: "Parametrlər", parts: [{ key: "settings", label: "Parametrlər", actions: FIXED }] },
  ],
  // Versiya 3.57: the parts are named simply "Tabel" and "Maaş".
  // Versiya 3.54: Əməkhaqqı cədvəlləri — the payroll accountant (e.g. the head of Mühasibatlıq). A department head fills the tabel
  // of their own department without this right; it gives the tabel of every department of the firm and the payroll.
  "hr.payroll": [
    { key: "timesheet", label: "Tabel", parts: [{ key: "timesheet", label: "Tabel (bütün şöbələr: doldur, qəbul et, geri qaytar)", actions: FIXED }] },
    { key: "payroll", label: "Maaş", parts: [{ key: "payroll", label: "Maaş (hesablanan əməkhaqqı: doldur, təsdiqlə)", actions: FIXED }] },
  ],
};
// Sections whose every right is given in their parts: the section's own checkbox only opens it (Baxış).
export const PARTS_ONLY_SECTIONS: readonly SectionKey[] = ["hr.orders", "hr.payroll"];
export const sectionParts = (section: string): SectionPart[] => (SECTION_PARTS[section as SectionKey] ?? []).flatMap((g) => g.parts);
export type PartRights = Record<SectionAction, boolean>;
export type PartsRights = Record<string, PartRights>;

export type FirmSectionRights = { actions: SectionAction[]; types?: number[]; parts?: Record<string, SectionAction[]> };
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
      const actions = ACTIONS.filter((a) => Array.isArray(entry?.actions) && entry.actions.includes(a) && (isLeveled(section) || a === "view"));
      // Any of Əlavə et / Dəyişiklik et / Sil implies Baxış.
      if (actions.length && !actions.includes("view")) actions.unshift("view");
      if (!actions.length) continue;
      const types = TYPED_SECTIONS.includes(section) && Array.isArray(entry?.types) ? [...new Set(entry.types.map(Number).filter((id) => id > 0))] : undefined;
      const rawParts = (entry as { parts?: unknown } | undefined)?.parts;
      let parts: Record<string, SectionAction[]> | undefined;
      if (sectionParts(section).length && rawParts && typeof rawParts === "object" && !Array.isArray(rawParts)) {
        parts = {};
        for (const part of sectionParts(section)) {
          const list = (rawParts as Record<string, unknown>)[part.key];
          const given = part.actions.filter((a) => Array.isArray(list) && list.includes(a));
          if (given.length && !given.includes("view")) given.unshift("view");
          if (given.length) parts[part.key] = given;
        }
      }
      firm[section] = { actions, ...(types ? { types } : {}), ...(parts ? { parts } : {}) };
    }
    if (Object.keys(firm).length) result[String(Number(companyId))] = firm;
  }
  return result;
}

// What the section's own rights meant inside it before the parts had rights: in Personallar Baxış showed the whole card and
// Dəyişiklik et changed everything in it, rows added and removed included (Əlavə et and Sil were the new card and deleting it);
// in Əmrlər each right meant the same in every tab (Dəyişiklik et also covered the numbering settings).
const legacyPartActions = (section: string, actions: SectionAction[]): SectionAction[] =>
  section === "hr.personnel" ? (actions.includes("edit") ? [...ACTIONS] : actions.includes("view") ? ["view"] : []) : actions;

// The rights of every part of a section in one firm entry: the part's own list, or (no "parts" stored) what the section's
// rights gave there before.
export function partsRightsOf(section: string, entry: FirmSectionRights | undefined | null): PartsRights {
  const result: PartsRights = {};
  for (const part of sectionParts(section)) {
    const given = !entry ? [] : entry.parts ? entry.parts[part.key] ?? [] : legacyPartActions(section, entry.actions);
    const has = (a: SectionAction) => part.actions.includes(a) && given.includes(a);
    result[part.key] = { view: has("view"), add: has("add"), edit: has("edit"), delete: has("delete") };
  }
  return result;
}
export const allPartsRights = (section: string): PartsRights => partsRightsOf(section, { actions: [...ACTIONS] });

// The rights of one firm section; types null = every document type.
export function firmSectionRights(permissions: CompanyPermissions, companyId: number, section: FirmSection) {
  const entry = permissions[String(companyId)]?.[section];
  const has = (action: SectionAction) => Boolean(entry?.actions.includes(action));
  return { view: has("view"), add: has("add"), edit: has("edit"), delete: has("delete"), types: entry?.types ?? null, parts: partsRightsOf(section, entry) };
}

// What the old (pre-2.99) one-for-all rights meant, written out for each of the user's firms — the migration, so nobody's rights change.
export function companyPermissionsFromStored(stored: string[], companyIds: number[]): CompanyPermissions {
  const denied = deniedFromStored(stored);
  const firm: Partial<Record<FirmSection, FirmSectionRights>> = {};
  for (const section of FIRM_SECTIONS) {
    const actions = ACTIONS.filter((a) => !denied.has(section) && !denied.has(actionKey(section, a)) && (isLeveled(section) || a === "view"));
    if (actions.length) firm[section] = { actions };
  }
  return Object.fromEntries(companyIds.map((id) => [String(id), structuredClone(firm)]));
}

// Menus and the coarse locks: a firm section counts as open (and a right as given) when any of the user's firms has it.
export function deniedWithFirms(stored: string[], permissions: CompanyPermissions, companyIds: number[]): Set<string> {
  const denied = deniedFromStored(stored);
  for (const section of FIRM_SECTIONS) {
    denied.delete(section);
    if (!isLeveled(section)) {
      if (!companyIds.some((id) => firmSectionRights(permissions, id, section).view)) denied.add(section);
      continue;
    }
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
