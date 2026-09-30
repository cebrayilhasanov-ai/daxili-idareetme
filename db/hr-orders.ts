import { env } from "@/lib/runtime";
import type { SessionUser } from "@/lib/auth";
import { ensureHrSchema, getHrParams } from "@/db/hr";
import { getDocumentTemplates } from "@/db/catalog";
import { TERMINATION_REASONS, indexCalendar, isIsoDate, settlement, todayIso, type CalendarDay, type SalaryRow } from "@/lib/hr-calc";
import {
  ORDER_GROUPS, ORDER_LEAVE_KINDS, leaveOrderText, normalizeLeaveLegal, normalizeTerminationLegal, orderNumber, planLeaveOrder, settlementSnapshot, terminationOrderText,
  type LeaveLegal, type OrderEmployee, type OrderGroup, type TerminationExtra, type TerminationLegal,
} from "@/lib/hr-orders";

// HR orders (əmrlər): a register per firm, numbered per group and year from the firm's own pattern. An order is printed from
// the system and counts only once its signed copy is uploaded — a leave order then puts the leave on the worker's card.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

let ready = false;
async function ensureOrdersSchema() {
  await ensureHrSchema();
  if (ready) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER NOT NULL,
    grp TEXT NOT NULL,
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    order_no TEXT NOT NULL,
    order_date TEXT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    kind TEXT,
    start_date TEXT,
    end_date TEXT,
    days REAL,
    basis TEXT,
    title TEXT NOT NULL,
    legal_text TEXT,
    items TEXT NOT NULL,
    signed_key TEXT,
    signed_name TEXT,
    signed_size INTEGER,
    signed_type TEXT,
    signed_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE(company_id, grp, year, seq)
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_order_numbering (
    company_id INTEGER NOT NULL,
    grp TEXT NOT NULL,
    pattern TEXT NOT NULL,
    PRIMARY KEY (company_id, grp)
  )`).run();
  const orderColumns = (await db().prepare("PRAGMA table_info(hr_orders)").all<{ name: string }>()).results;
  if (!orderColumns.some((c: { name: string }) => c.name === "extra")) await db().prepare("ALTER TABLE hr_orders ADD COLUMN extra TEXT").run();
  ready = true;
}

const text = (value: unknown) => { const v = String(value ?? "").trim(); return v || null; };

async function getTerminationLegal(): Promise<TerminationLegal> {
  const row = await db().prepare("SELECT value FROM hr_settings WHERE key = 'orders_termination_legal'").first<{ value: string | null }>();
  try { return normalizeTerminationLegal(row?.value ? JSON.parse(row.value) : {}); } catch { return normalizeTerminationLegal({}); }
}

async function getLegal(): Promise<LeaveLegal> {
  const row = await db().prepare("SELECT value FROM hr_settings WHERE key = 'orders_legal'").first<{ value: string | null }>();
  try { return normalizeLeaveLegal(row?.value ? JSON.parse(row.value) : {}); } catch { return normalizeLeaveLegal({}); }
}

// Only what orders need: no salaries, ID card numbers or addresses (the Orders permission is separate from Personallar).
const EMPLOYEE_COLUMNS = `hr_employees.id, hr_employees.company_id, hr_employees.department, hr_employees.position, hr_employees.last_name, hr_employees.first_name,
  hr_employees.patronymic, hr_employees.gender, hr_employees.hire_date, hr_employees.termination_date, hr_employees.prior_experience_months,
  hr_employees.base_leave_days, hr_employees.extra_leave_days, hr_employees.extra_leave_note, hr_employees.work_week,
  hr_employees.opening_balance_date, hr_employees.opening_balance_days, hr_employees.contract_no, hr_employees.contract_date, hr_employees.termination_reason`;

export async function getOrdersData() {
  await ensureOrdersSchema();
  const [orders, employees, leaves, calendar, children, companies, numbering, params, legal, terminationLegal] = await Promise.all([
    db().prepare(`SELECT hr_orders.*, companies.name AS company_name, hr_employees.last_name, hr_employees.first_name, hr_employees.patronymic
      FROM hr_orders LEFT JOIN companies ON companies.id = hr_orders.company_id LEFT JOIN hr_employees ON hr_employees.id = hr_orders.hr_employee_id
      ORDER BY hr_orders.order_date DESC, hr_orders.id DESC`).all(),
    db().prepare(`SELECT ${EMPLOYEE_COLUMNS}, companies.name AS company_name FROM hr_employees LEFT JOIN companies ON companies.id = hr_employees.company_id ORDER BY hr_employees.last_name, hr_employees.first_name`).all(),
    db().prepare("SELECT id, hr_employee_id, kind, start_date, end_date, days, order_no, order_id FROM hr_leaves ORDER BY start_date").all(),
    db().prepare("SELECT date, kind, name FROM hr_calendar ORDER BY date").all<CalendarDay>(),
    db().prepare("SELECT hr_employee_id, relation, birth_date FROM hr_family WHERE relation IN ('Oğlu', 'Qızı')").all(),
    db().prepare("SELECT id, name, manager FROM companies WHERE active = 1 ORDER BY name").all(),
    db().prepare("SELECT company_id, grp, pattern FROM hr_order_numbering").all(),
    getHrParams(),
    getLegal(),
    getTerminationLegal(),
  ]);
  // "Digər əmrlər" templates (Şablonlar, group "Digər əmr"); getDocumentTemplates also makes sure that table exists.
  const templates = ((await getDocumentTemplates()) as { id: number; name: string; template_group: string | null; template1_key: string | null; template1_name: string | null }[])
    .filter((t) => t.template_group === "other_order").map((t) => ({ id: t.id, name: t.name, template1_key: t.template1_key, template1_name: t.template1_name }));
  return { templates, terminationLegal, orders: orders.results, employees: employees.results, leaves: leaves.results, calendar: calendar.results, children: children.results, companies: companies.results, numbering: numbering.results, params, legal };
}

function childrenUnder14(rows: { birth_date: string | null }[], on: string) {
  return rows.filter((c) => {
    if (!c.birth_date || !isIsoDate(c.birth_date)) return false;
    let age = Number(on.slice(0, 4)) - Number(c.birth_date.slice(0, 4));
    if (on.slice(5) < c.birth_date.slice(5)) age -= 1;
    return age < 14;
  }).length;
}

async function patternFor(companyId: number, grp: OrderGroup) {
  const row = await db().prepare("SELECT pattern FROM hr_order_numbering WHERE company_id = ? AND grp = ?").bind(companyId, grp).first<{ pattern: string }>();
  return row?.pattern || ORDER_GROUPS.find((g) => g.key === grp)?.defaultPattern || "{No}";
}

// Builds a leave order from the card exactly as the page previews it, and checks it against the worker's other leaves.
async function buildLeaveOrder(input: Record<string, unknown>, selfId: number | null) {
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçini seçin.");
  const emp = await db().prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM hr_employees WHERE id = ?`).bind(employeeId).first<OrderEmployee>();
  if (!emp) throw new Error("İşçi tapılmadı.");
  if (!emp.company_id) throw new Error("İşçinin kartında firma seçilməyib — əmr firmanın adından verilir.");
  const kind = String(input.kind || "");
  if (!ORDER_LEAVE_KINDS.some((k) => k.key === kind)) throw new Error("Məzuniyyətin növünü seçin.");
  const startDate = String(input.startDate || ""), endDate = String(input.endDate || "");
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new Error("Məzuniyyətin başlama və bitmə tarixlərini daxil edin.");
  if (endDate < startDate) throw new Error("Bitmə tarixi başlama tarixindən əvvəl ola bilməz.");
  if (startDate < emp.hire_date) throw new Error("Məzuniyyət işə qəbul tarixindən əvvəl başlaya bilməz.");
  if (emp.termination_date && startDate > emp.termination_date) throw new Error("İşçi bu tarixdə artıq işdən çıxıb.");
  const orderDate = String(input.orderDate || todayIso());
  if (!isIsoDate(orderDate)) throw new Error("Əmrin tarixi düzgün deyil.");
  const clash = await db().prepare(`SELECT start_date, end_date, order_no FROM hr_leaves WHERE hr_employee_id = ? AND start_date <= ? AND end_date >= ? AND (order_id IS NULL OR order_id != ?)
    UNION ALL SELECT start_date, end_date, order_no FROM hr_orders WHERE hr_employee_id = ? AND grp = 'leave' AND status = 'pending' AND start_date <= ? AND end_date >= ? AND id != ?`)
    .bind(employeeId, endDate, startDate, selfId || 0, employeeId, endDate, startDate, selfId || 0).first<{ start_date: string; end_date: string; order_no: string | null }>();
  if (clash) throw new Error(`Bu dövr işçinin başqa məzuniyyəti ilə üst-üstə düşür (${clash.start_date} – ${clash.end_date}${clash.order_no ? `, əmr № ${clash.order_no}` : ""}).`);
  const [leaves, calendar, children, params, legal] = await Promise.all([
    db().prepare("SELECT id, kind, start_date, end_date, days, order_no FROM hr_leaves WHERE hr_employee_id = ?").bind(employeeId).all(),
    db().prepare("SELECT date, kind, name FROM hr_calendar WHERE date BETWEEN ? AND ?").bind(`${Number(emp.hire_date.slice(0, 4)) - 1}-01-01`, `${Number(endDate.slice(0, 4)) + 1}-12-31`).all<CalendarDay>(),
    db().prepare("SELECT birth_date FROM hr_family WHERE hr_employee_id = ? AND relation IN ('Oğlu', 'Qızı')").bind(employeeId).all<{ birth_date: string | null }>(),
    getHrParams(),
    getLegal(),
  ]);
  const leaveInput = { kind, startDate, endDate, basis: text(input.basis) || "İşçinin ərizəsi" };
  const plan = planLeaveOrder(emp, leaveInput, { leaves: leaves.results as never, calendar: calendar.results, params, legal, childrenUnder14: childrenUnder14(children.results, startDate) });
  if (!plan.days) throw new Error("Bu dövrdə məzuniyyət günü yoxdur (bütün günlər bayramdır).");
  const body = leaveOrderText(emp, leaveInput, plan);
  return { emp, kind, startDate, endDate, orderDate, basis: leaveInput.basis, plan, body };
}

export async function createLeaveOrder(user: SessionUser, input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const built = await buildLeaveOrder(input, null);
  const companyId = built.emp.company_id as number;
  const year = Number(built.orderDate.slice(0, 4));
  const pattern = await patternFor(companyId, "leave");
  // Numbers restart each year per firm and group; the UNIQUE key refuses a second order with the same number if two are saved at once.
  const next = await db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM hr_orders WHERE company_id = ? AND grp = 'leave' AND year = ?").bind(companyId, year).first<{ seq: number }>();
  const seq = next?.seq || 1;
  const result = await db().prepare(`INSERT INTO hr_orders (company_id, grp, year, seq, order_no, order_date, hr_employee_id, status, kind, start_date, end_date, days, basis, title, legal_text, items, created_by, created_at)
    VALUES (?, 'leave', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(companyId, year, seq, orderNumber(pattern, seq, built.orderDate), built.orderDate, built.emp.id, built.kind, built.startDate, built.endDate, built.plan.days, built.basis,
      built.body.title, built.plan.legalText, JSON.stringify(built.body.items), user.name, new Date().toISOString()).run();
  return Number(result.meta.last_row_id);
}

async function orderById(id: number) {
  const row = await db().prepare("SELECT * FROM hr_orders WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("Əmr tapılmadı.");
  return row;
}

// A pending order can still be corrected; its number stays. A signed one is final — it can only be cancelled.
export async function updateLeaveOrder(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const id = Number(input.id);
  const current = await orderById(id);
  if (current.status !== "pending") throw new Error("İmzalanmış və ya ləğv edilmiş əmr dəyişdirilə bilməz.");
  const built = await buildLeaveOrder(input, id);
  if (built.emp.id !== Number(current.hr_employee_id)) throw new Error("Əmrin işçisi dəyişdirilə bilməz — bu əmri ləğv edib yenisini verin.");
  if (built.orderDate.slice(0, 4) !== String(current.year)) throw new Error("Əmrin tarixi başqa ilə keçirilə bilməz (nömrə il üzrə verilib).");
  await db().prepare("UPDATE hr_orders SET order_date = ?, kind = ?, start_date = ?, end_date = ?, days = ?, basis = ?, title = ?, legal_text = ?, items = ?, updated_at = ? WHERE id = ?")
    .bind(built.orderDate, built.kind, built.startDate, built.endDate, built.plan.days, built.basis, built.body.title, built.plan.legalText, JSON.stringify(built.body.items), new Date().toISOString(), id).run();
}

// The signed copy makes the order count: a leave order then records the leave on the card (once — a later re-upload only swaps the file).
export async function signOrder(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const id = Number(input.id);
  const order = await orderById(id);
  if (order.status === "cancelled") throw new Error("Ləğv edilmiş əmrə fayl yüklənə bilməz.");
  const key = text(input.key), name = text(input.name);
  if (!key || !name) throw new Error("İmzalı nüsxənin faylını seçin.");
  const now = new Date().toISOString();
  const statements = [db().prepare("UPDATE hr_orders SET status = 'signed', signed_key = ?, signed_name = ?, signed_size = ?, signed_type = ?, signed_at = COALESCE(signed_at, ?), updated_at = ? WHERE id = ?")
    .bind(key, name, Number(input.size) || null, text(input.type), now, now, id)];
  if (order.grp === "termination" && order.status === "pending") {
    const extra = parseExtra(order.extra);
    const { snapshot } = await settlementFor(Number(order.hr_employee_id), String(order.start_date), String(order.kind), extra);
    statements.push(db().prepare("UPDATE hr_employees SET termination_date = ?, termination_reason = ?, termination_order_id = ?, updated_at = ? WHERE id = ?")
      .bind(order.start_date, order.kind, id, now, order.hr_employee_id));
    statements.push(db().prepare("UPDATE hr_orders SET extra = ? WHERE id = ?").bind(JSON.stringify({ ...extra, settlement: snapshot }), id));
  }
  if (order.grp === "leave" && order.status === "pending") {
    statements.push(db().prepare("INSERT INTO hr_leaves (hr_employee_id, kind, start_date, end_date, days, order_no, order_date, note, created_at, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(order.hr_employee_id, order.kind, order.start_date, order.end_date, order.days, order.order_no, order.order_date, order.basis, now, id));
  }
  await db().batch(statements);
  return order;
}

export async function cancelOrder(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const id = Number(input.id);
  const order = await orderById(id);
  if (order.status === "cancelled") throw new Error("Əmr artıq ləğv edilib.");
  const reason = text(input.reason);
  if (!reason) throw new Error("Ləğv etmənin səbəbini yazın.");
  await db().batch([
    db().prepare("UPDATE hr_orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), reason, new Date().toISOString(), id),
    db().prepare("DELETE FROM hr_leaves WHERE order_id = ?").bind(id),
    db().prepare("UPDATE hr_employees SET termination_date = NULL, termination_reason = NULL, termination_order_id = NULL WHERE termination_order_id = ?").bind(id),
  ]);
  return order;
}

export async function saveOrderSettings(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const numbering = Array.isArray(input.numbering) ? input.numbering as Record<string, unknown>[] : [];
  const statements = [];
  for (const row of numbering) {
    const companyId = Number(row.companyId), grp = String(row.grp || "");
    const pattern = text(row.pattern);
    if (!companyId || !ORDER_GROUPS.some((g) => g.key === grp)) continue;
    if (pattern && !/\{No\}/i.test(pattern)) throw new Error(`Nömrə şablonunda {No} olmalıdır: "${pattern}".`);
    statements.push(pattern
      ? db().prepare("INSERT INTO hr_order_numbering (company_id, grp, pattern) VALUES (?, ?, ?) ON CONFLICT(company_id, grp) DO UPDATE SET pattern = excluded.pattern").bind(companyId, grp, pattern)
      : db().prepare("DELETE FROM hr_order_numbering WHERE company_id = ? AND grp = ?").bind(companyId, grp));
  }
  if (input.terminationLegal) statements.push(db().prepare("INSERT INTO hr_settings (key, value) VALUES ('orders_termination_legal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(normalizeTerminationLegal(input.terminationLegal))));
  if (input.legal) statements.push(db().prepare("INSERT INTO hr_settings (key, value) VALUES ('orders_legal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(normalizeLeaveLegal(input.legal))));
  if (statements.length) await db().batch(statements);
}

// ---------------------------------------------------------------- termination orders
const parseExtra = (raw: unknown): TerminationExtra => {
  try { const v = JSON.parse(String(raw || "{}")); return { severance: Boolean(v.severance), workedDays: v.workedDays === null || v.workedDays === undefined || v.workedDays === "" ? null : Number(v.workedDays), deductOverused: Boolean(v.deductOverused), settlement: v.settlement }; }
  catch { return { severance: false, workedDays: null, deductOverused: false }; }
};

// Salaries are needed only for the final settlement of the worker being dismissed.
export async function getEmployeeSalaries(employeeId: number) {
  await ensureOrdersSchema();
  const [emp, salaries] = await Promise.all([
    db().prepare("SELECT monthly_salary FROM hr_employees WHERE id = ?").bind(employeeId).first<{ monthly_salary: number | null }>(),
    db().prepare("SELECT period, amount FROM hr_salaries WHERE hr_employee_id = ? ORDER BY period").bind(employeeId).all<SalaryRow>(),
  ]);
  return { monthlySalary: emp?.monthly_salary ?? null, salaries: salaries.results };
}

async function settlementFor(employeeId: number, date: string, reasonKey: string, extra: TerminationExtra) {
  const emp = await db().prepare(`SELECT ${EMPLOYEE_COLUMNS}, hr_employees.monthly_salary FROM hr_employees WHERE id = ?`).bind(employeeId).first<OrderEmployee & { monthly_salary: number | null }>();
  if (!emp) throw new Error("İşçi tapılmadı.");
  const [leaves, calendar, pay, params] = await Promise.all([
    db().prepare("SELECT id, kind, start_date, end_date, days, order_no FROM hr_leaves WHERE hr_employee_id = ?").bind(employeeId).all(),
    db().prepare("SELECT date, kind, name FROM hr_calendar ORDER BY date").all<CalendarDay>(),
    getEmployeeSalaries(employeeId),
    getHrParams(),
  ]);
  const result = settlement({ ...emp, termination_date: null }, leaves.results as never, pay.salaries, indexCalendar(calendar.results), params, { date, reasonKey, severance: extra.severance, workedDays: extra.workedDays, deductOverused: extra.deductOverused });
  return { result, snapshot: settlementSnapshot(result, pay.monthlySalary, extra.severance, extra.deductOverused, date), emp };
}

async function buildTerminationOrder(input: Record<string, unknown>, selfId: number | null) {
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçini seçin.");
  const emp = await db().prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM hr_employees WHERE id = ?`).bind(employeeId).first<OrderEmployee & { contract_no: string | null; contract_date: string | null }>();
  if (!emp) throw new Error("İşçi tapılmadı.");
  if (!emp.company_id) throw new Error("İşçinin kartında firma seçilməyib — əmr firmanın adından verilir.");
  if (emp.termination_date) throw new Error(`İşçi artıq ${emp.termination_date} tarixində işdən çıxıb.`);
  const date = String(input.terminationDate || "");
  if (!isIsoDate(date)) throw new Error("İşdən çıxma tarixini daxil edin.");
  if (date < emp.hire_date) throw new Error("İşdən çıxma tarixi işə qəbul tarixindən əvvəl ola bilməz.");
  const reasonKey = String(input.reasonKey || "");
  if (!TERMINATION_REASONS.some((r) => r.key === reasonKey)) throw new Error("İşdən çıxma əsasını seçin.");
  const orderDate = String(input.orderDate || todayIso());
  if (!isIsoDate(orderDate)) throw new Error("Əmrin tarixi düzgün deyil.");
  const other = await db().prepare("SELECT order_no FROM hr_orders WHERE hr_employee_id = ? AND grp = 'termination' AND status = 'pending' AND id != ?").bind(employeeId, selfId || 0).first<{ order_no: string }>();
  if (other) throw new Error(`Bu işçi üçün imza gözləyən işdən çıxma əmri artıq var (№ ${other.order_no}).`);
  const worked = input.workedDays === null || input.workedDays === undefined || String(input.workedDays).trim() === "" ? null : Number(input.workedDays);
  if (worked !== null && (!Number.isFinite(worked) || worked < 0)) throw new Error("İşlənmiş gün sayı düzgün deyil.");
  const extra: TerminationExtra = { severance: Boolean(input.severance), workedDays: worked, deductOverused: Boolean(input.deductOverused) };
  const { result } = await settlementFor(employeeId, date, reasonKey, extra);
  const legal = (await getTerminationLegal())[reasonKey] || "";
  const basis = text(input.basis) || (reasonKey === "own" ? "İşçinin ərizəsi" : "");
  const body = terminationOrderText(emp, { date, reasonKey, basis, severance: extra.severance, contractNo: emp.contract_no, contractDate: emp.contract_date }, result);
  return { emp, date, reasonKey, orderDate, basis, extra, legal, body };
}

export async function createTerminationOrder(user: SessionUser, input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const built = await buildTerminationOrder(input, null);
  const companyId = built.emp.company_id as number;
  const year = Number(built.orderDate.slice(0, 4));
  const pattern = await patternFor(companyId, "termination");
  const next = await db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM hr_orders WHERE company_id = ? AND grp = 'termination' AND year = ?").bind(companyId, year).first<{ seq: number }>();
  const seq = next?.seq || 1;
  const result = await db().prepare(`INSERT INTO hr_orders (company_id, grp, year, seq, order_no, order_date, hr_employee_id, status, kind, start_date, end_date, days, basis, title, legal_text, items, extra, created_by, created_at)
    VALUES (?, 'termination', ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(companyId, year, seq, orderNumber(pattern, seq, built.orderDate), built.orderDate, built.emp.id, built.reasonKey, built.date, built.basis,
      built.body.title, built.legal, JSON.stringify(built.body.items), JSON.stringify(built.extra), user.name, new Date().toISOString()).run();
  return Number(result.meta.last_row_id);
}

export async function updateTerminationOrder(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const id = Number(input.id);
  const current = await orderById(id);
  if (current.status !== "pending") throw new Error("İmzalanmış və ya ləğv edilmiş əmr dəyişdirilə bilməz.");
  const built = await buildTerminationOrder(input, id);
  if (built.emp.id !== Number(current.hr_employee_id)) throw new Error("Əmrin işçisi dəyişdirilə bilməz — bu əmri ləğv edib yenisini verin.");
  if (built.orderDate.slice(0, 4) !== String(current.year)) throw new Error("Əmrin tarixi başqa ilə keçirilə bilməz (nömrə il üzrə verilib).");
  await db().prepare("UPDATE hr_orders SET order_date = ?, kind = ?, start_date = ?, basis = ?, title = ?, legal_text = ?, items = ?, extra = ?, updated_at = ? WHERE id = ?")
    .bind(built.orderDate, built.reasonKey, built.date, built.basis, built.body.title, built.legal, JSON.stringify(built.body.items), JSON.stringify(built.extra), new Date().toISOString(), id).run();
}

// ---------------------------------------------------------------- other orders
// The text comes from a "Digər əmr" template (read and filled in the browser) and may be edited before it is registered.
async function buildOtherOrder(input: Record<string, unknown>) {
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçini seçin.");
  const emp = await db().prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM hr_employees WHERE id = ?`).bind(employeeId).first<OrderEmployee>();
  if (!emp) throw new Error("İşçi tapılmadı.");
  if (!emp.company_id) throw new Error("İşçinin kartında firma seçilməyib — əmr firmanın adından verilir.");
  const templateId = Number(input.templateId) || null;
  if (templateId) {
    const template = await db().prepare("SELECT template_group FROM document_templates WHERE id = ?").bind(templateId).first<{ template_group: string | null }>();
    if (!template || template.template_group !== "other_order") throw new Error("Seçilmiş şablon “Digər əmr” qrupunda deyil.");
  }
  const title = text(input.title);
  if (!title) throw new Error("Əmrin adını yazın (məs. “Mükafatlandırma haqqında”).");
  const items = String(input.body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!items.length) throw new Error("Əmrin mətnini yazın və ya şablondan oxuyun.");
  const orderDate = String(input.orderDate || todayIso());
  if (!isIsoDate(orderDate)) throw new Error("Əmrin tarixi düzgün deyil.");
  return { emp, templateId, title, items, orderDate, basis: text(input.basis) };
}

export async function createOtherOrder(user: SessionUser, input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const built = await buildOtherOrder(input);
  const companyId = built.emp.company_id as number;
  const year = Number(built.orderDate.slice(0, 4));
  const pattern = await patternFor(companyId, "other");
  const next = await db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM hr_orders WHERE company_id = ? AND grp = 'other' AND year = ?").bind(companyId, year).first<{ seq: number }>();
  const seq = next?.seq || 1;
  const result = await db().prepare(`INSERT INTO hr_orders (company_id, grp, year, seq, order_no, order_date, hr_employee_id, status, kind, basis, title, legal_text, items, created_by, created_at)
    VALUES (?, 'other', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?, ?)`)
    .bind(companyId, year, seq, orderNumber(pattern, seq, built.orderDate), built.orderDate, built.emp.id, built.templateId ? String(built.templateId) : null, built.basis,
      built.title, JSON.stringify(built.items), user.name, new Date().toISOString()).run();
  return Number(result.meta.last_row_id);
}

export async function updateOtherOrder(input: Record<string, unknown>) {
  await ensureOrdersSchema();
  const id = Number(input.id);
  const current = await orderById(id);
  if (current.status !== "pending") throw new Error("İmzalanmış və ya ləğv edilmiş əmr dəyişdirilə bilməz.");
  const built = await buildOtherOrder(input);
  if (built.emp.id !== Number(current.hr_employee_id)) throw new Error("Əmrin işçisi dəyişdirilə bilməz — bu əmri ləğv edib yenisini verin.");
  if (built.orderDate.slice(0, 4) !== String(current.year)) throw new Error("Əmrin tarixi başqa ilə keçirilə bilməz (nömrə il üzrə verilib).");
  await db().prepare("UPDATE hr_orders SET order_date = ?, kind = ?, basis = ?, title = ?, items = ?, updated_at = ? WHERE id = ?")
    .bind(built.orderDate, built.templateId ? String(built.templateId) : null, built.basis, built.title, JSON.stringify(built.items), new Date().toISOString(), id).run();
}

export async function orderLabel(id: number) {
  const row = await db().prepare("SELECT order_no, grp FROM hr_orders WHERE id = ?").bind(id).first<{ order_no: string; grp: string }>();
  return row ? `№ ${row.order_no}` : `#${id}`;
}
