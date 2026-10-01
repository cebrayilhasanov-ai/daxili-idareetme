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
  "tasks.monthly",
  "tasks.weekly",
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

const VALID_KEYS = new Set<string>([...SECTION_KEYS, ...LEVELED_SECTIONS.flatMap((s) => ACTIONS.map((a) => actionKey(s, a)))]);

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
      if (isOptIn(section) ? !flips.has(section) : flips.has(section)) denied.add(section);
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
