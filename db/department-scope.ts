import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import { companyDepartments } from "@/db/requests";

// HR by department (Versiya 2.65): in Nöqsanlar, Personallar and Əmrlər everyone works — within the rights the admin gave —
// only with the people of the departments they oversee: their own, and those under them in the firm's structure
// (Firmalar → Struktur, "reports to"). The director, at the top, oversees the whole firm; the admin everything (scope null).

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

export type DepartmentScope = Map<number, Set<string>> | null;

export async function departmentScope(user: SessionUser): Promise<DepartmentScope> {
  if (user.role === "admin") return null;
  const scope = new Map<number, Set<string>>();
  if (!user.employeeId) return scope;
  const structure = await companyDepartments();
  const firms = (await db().prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(user.employeeId).all<{ company_id: number }>()).results;
  for (const { company_id } of firms) {
    const names = structure.overseenBy(company_id, user.employeeId);
    if (names.length) scope.set(company_id, new Set(names));
  }
  return scope;
}

export const inScope = (scope: DepartmentScope, companyId: unknown, department: unknown) =>
  scope === null || Boolean(companyId && department && scope.get(Number(companyId))?.has(String(department).trim()));

export const scopeCompanyIds = (scope: DepartmentScope) => (scope ? [...scope.keys()] : null);

// An HR card (hr_employees) the user may work with; throws FORBIDDEN otherwise.
export async function requireHrEmployeeInScope(scope: DepartmentScope, hrEmployeeId: number) {
  if (scope === null) return;
  const row = await db().prepare("SELECT company_id, department FROM hr_employees WHERE id = ?").bind(hrEmployeeId).first<{ company_id: number | null; department: string | null }>();
  if (!row || !inScope(scope, row.company_id, row.department)) throw new Error("FORBIDDEN");
}

// The departments an app user (employees table) works in, per firm — to place a violation in the scope.
export async function userDepartments() {
  const structure = await companyDepartments();
  return (companyId: number, employeeId: number) => structure.memberOf(companyId, employeeId);
}

// A row of a card's sub-table (leave, family member, education) belongs to the scope through its card.
const CARD_TABLES = { leave: "hr_leaves", family: "hr_family", education: "hr_education" } as const;
export async function requireCardRowInScope(scope: DepartmentScope, kind: keyof typeof CARD_TABLES, id: number) {
  if (scope === null) return;
  const row = await db().prepare(`SELECT hr_employee_id FROM ${CARD_TABLES[kind]} WHERE id = ?`).bind(id).first<{ hr_employee_id: number }>();
  if (!row) throw new Error("Qeyd tapılmadı.");
  await requireHrEmployeeInScope(scope, row.hr_employee_id);
}

type Row = Record<string, unknown>;
// HR register data narrowed to the scope: the cards, everything hanging on them, and the firms/departments to pick from.
export function scopeHrData<T extends Record<string, unknown>>(data: T, scope: DepartmentScope): T {
  if (scope === null) return data;
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as Row[]) : []);
  const employees = list("employees").filter((e) => inScope(scope, e.company_id, e.department));
  const ids = new Set(employees.map((e) => Number(e.id)));
  const own = (key: string) => list(key).filter((r) => ids.has(Number(r.hr_employee_id)));
  const narrowed: Row = { ...data, employees, companies: list("companies").filter((c) => scope.has(Number(c.id))) };
  for (const key of ["leaves", "salaries", "priorJobs", "family", "education", "children"]) if (key in data) narrowed[key] = own(key);
  if ("structure" in data) narrowed.structure = list("structure").filter((r) => inScope(scope, r.company_id, r.department));
  if ("orders" in data) narrowed.orders = own("orders");
  return narrowed as T;
}

// An order belongs to the scope through the worker it is about.
export async function requireOrderInScope(scope: DepartmentScope, orderId: number) {
  if (scope === null) return;
  const row = await db().prepare("SELECT hr_employee_id FROM hr_orders WHERE id = ?").bind(orderId).first<{ hr_employee_id: number }>();
  if (!row) throw new Error("Əmr tapılmadı.");
  await requireHrEmployeeInScope(scope, row.hr_employee_id);
}

// An app user (Nöqsanlar are recorded on them) is in the scope when they work in an overseen department of the firm —
// the violation's firm, or any of the viewer's firms when the violation has none.
export async function userScopeTest(scope: DepartmentScope) {
  const departmentsOf = await userDepartments();
  return (employeeId: number, companyId: number | null) => {
    if (scope === null) return true;
    const firms = companyId ? [companyId] : [...scope.keys()];
    return firms.some((c) => departmentsOf(c, employeeId).some((d) => scope.get(c)?.has(d)));
  };
}
