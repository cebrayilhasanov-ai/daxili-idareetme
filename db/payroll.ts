import { env } from "@/lib/runtime";
import { markSchemaCurrent, schemaIsCurrent } from "@/lib/schema-version";
import { ensureHrSchema, getHrParams } from "@/db/hr";
import { addDays, addMonths, indexCalendar, monthEnd, round2, type CalendarDay, type HrLeaveCalc, type SalaryRow } from "@/lib/hr-calc";
import { leavePay } from "@/lib/leave-pay";
import {
  EMPTY_INPUTS, PAID_LEAVE_KINDS, PAYROLL_INPUT_KEYS, normalizeMark, normalizeOvertime, overtimeHours, payrollRow, timesheetRow,
  type LeavePay, type PayrollInputs, type SettlementPay,
} from "@/lib/payroll-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54). Per firm and month: the tabel of each department (filled by its head, handed in,
// accepted or sent back by the payroll accountant), the overtime tabel, and the payroll built from the accepted tabels.
// Only what differs from the automatic value of a day is stored (hr_timesheet_marks), so a change in the production calendar
// or a leave order signed later shows up by itself until the department's tabel is accepted.
// Versiya 3.56: the payroll also gets each worker's FİN and place of work (Əsas / Əlavə) and the final settlement of the
// workers dismissed in the month (signed termination orders).

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

let ready = false;
// Raise it with every new table, column or one-time migration below (lib/schema-version.ts).
const SCHEMA_VERSION = "3.54";
async function ensurePayrollSchema() {
  await ensureHrSchema();
  if (ready) return;
  if (await schemaIsCurrent("payroll", SCHEMA_VERSION)) { ready = true; return; }
  await db().batch([
    db().prepare(`CREATE TABLE IF NOT EXISTS hr_timesheets (
      company_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      department TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_by TEXT,
      submitted_at TEXT,
      decided_by TEXT,
      decided_at TEXT,
      return_note TEXT,
      updated_at TEXT,
      PRIMARY KEY (company_id, period, department)
    )`),
    db().prepare(`CREATE TABLE IF NOT EXISTS hr_timesheet_marks (
      hr_employee_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      marks TEXT,
      overtime TEXT,
      updated_by TEXT,
      updated_at TEXT,
      PRIMARY KEY (hr_employee_id, period)
    )`),
    db().prepare(`CREATE TABLE IF NOT EXISTS hr_payrolls (
      company_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_by TEXT,
      approved_at TEXT,
      snapshot TEXT,
      PRIMARY KEY (company_id, period)
    )`),
    db().prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_inputs (
      hr_employee_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (hr_employee_id, period)
    )`),
  ]);
  await markSchemaCurrent("payroll", SCHEMA_VERSION);
  ready = true;
}

// What the viewer may do in one firm: see every department's tabel (or only the departments they head), change it, and see
// or fill the payroll. Worked out in the API from Giriş icazələri (hr.payroll) and the firm's structure.
export type PayrollAccess = { allDepartments: boolean; editAll: boolean; heads: string[]; payView: boolean; payEdit: boolean };

export const isPeriod = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const dept = (value: unknown) => String(value ?? "").trim();
const json = <T>(raw: unknown, fallback: T): T => { try { const v = JSON.parse(String(raw || "")); return v && typeof v === "object" ? v as T : fallback; } catch { return fallback; } };
const money = (value: unknown) => { const n = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? round2(n) : 0; };

type Employee = { id: number; last_name: string; first_name: string; patronymic: string | null; position: string | null; department: string | null; hire_date: string; termination_date: string | null; work_week: number; monthly_salary?: number | null; fin?: string | null; job_kind?: string | null };
type Leave = { id: number; hr_employee_id: number; kind: string; start_date: string; end_date: string; order_no: string | null; order_id: number | null };
type Sheet = { department: string; status: string; submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null; return_note: string | null };

// The firm's workers employed at any time in the month, as far as the viewer may see them.
async function monthEmployees(companyId: number, period: string, access: PayrollAccess): Promise<Employee[]> {
  const from = `${period}-01`, to = monthEnd(from);
  const rows = (await db().prepare(`SELECT id, last_name, first_name, patronymic, position, department, hire_date, termination_date, work_week, monthly_salary, fin, job_kind FROM hr_employees
    WHERE company_id = ? AND hire_date <= ? AND (termination_date IS NULL OR termination_date = '' OR termination_date >= ?) ORDER BY last_name, first_name`).bind(companyId, to, from).all<Employee>()).results;
  const visible = rows.filter((e) => access.allDepartments || access.heads.includes(dept(e.department)));
  return access.payView ? visible : visible.map((e) => ({ ...e, monthly_salary: undefined, fin: undefined }));
}

async function loadMonth(companyId: number, period: string, access: PayrollAccess) {
  await ensurePayrollSchema();
  const from = `${period}-01`, to = monthEnd(from);
  const employees = await monthEmployees(companyId, period, access);
  const ids = employees.map((e) => e.id);
  const inIds = ids.length ? `IN (${ids.map(() => "?").join(",")})` : "IN (NULL)";
  const [calendar, leaves, marks, sheets, payroll, params] = await Promise.all([
    db().prepare("SELECT date, kind, name FROM hr_calendar WHERE date BETWEEN ? AND ?").bind(from, to).all<CalendarDay>(),
    db().prepare(`SELECT id, hr_employee_id, kind, start_date, end_date, order_no, order_id FROM hr_leaves WHERE hr_employee_id ${inIds} AND start_date <= ? AND end_date >= ?`).bind(...ids, to, from).all<Leave>(),
    db().prepare(`SELECT hr_employee_id, marks, overtime FROM hr_timesheet_marks WHERE period = ? AND hr_employee_id ${inIds}`).bind(period, ...ids).all<{ hr_employee_id: number; marks: string | null; overtime: string | null }>(),
    db().prepare("SELECT department, status, submitted_by, submitted_at, decided_by, decided_at, return_note FROM hr_timesheets WHERE company_id = ? AND period = ?").bind(companyId, period).all<Sheet>(),
    db().prepare("SELECT status, approved_by, approved_at, snapshot FROM hr_payrolls WHERE company_id = ? AND period = ?").bind(companyId, period).first<{ status: string; approved_by: string | null; approved_at: string | null; snapshot: string | null }>(),
    getHrParams(),
  ]);
  // Departments of the month: those of its workers, each with its tabel's state (no row yet = a draft).
  const names = ([...new Set(employees.map((e) => dept(e.department)))] as string[]).sort((a, b) => (a ? b ? a.localeCompare(b, "az") : -1 : 1));
  const byName = new Map(sheets.results.map((s) => [s.department, s]));
  const departments = names.map((name) => ({ ...(byName.get(name) || { department: name, status: "draft", submitted_by: null, submitted_at: null, decided_by: null, decided_at: null, return_note: null }), department: name }));
  return {
    employees, calendar: calendar.results, leaves: leaves.results, params, departments,
    marks: marks.results.map((m) => ({ hr_employee_id: m.hr_employee_id, marks: json<Record<string, string>>(m.marks, {}), overtime: json<Record<string, number>>(m.overtime, {}) })),
    payroll: payroll ? { status: payroll.status, approved_by: payroll.approved_by, approved_at: payroll.approved_at, snapshot: access.payView ? json<unknown>(payroll.snapshot, null) : null } : { status: "draft", approved_by: null, approved_at: null, snapshot: null },
  };
}

// Leave pay of the month from the signed leave orders (Versiya 3.60, lib/leave-pay): the whole leave is worked out once — the
// average of the 12 months before the month it starts (140), not less than the last salary (111), holidays not paid (114.6) — and
// split by month; the payroll takes the part of its own month, so a leave over two months is paid and taxed in both and the
// parts add up to the whole. A missing month of earnings is not taken as 0: the part carries a warning instead.
async function leavePayOf(employees: Employee[], leaves: Leave[], period: string) {
  const paid = leaves.filter((l) => l.order_id && PAID_LEAVE_KINDS.includes(l.kind));
  if (!paid.length) return [] as LeavePay[];
  const ids = [...new Set(paid.map((l) => l.hr_employee_id))];
  const first = paid.reduce((min, l) => (l.start_date < min ? l.start_date : min), paid[0].start_date);
  const last = paid.reduce((max, l) => (l.end_date > max ? l.end_date : max), paid[0].end_date);
  const inIds = `IN (${ids.map(() => "?").join(",")})`;
  const [salaries, calendar, history, params] = await Promise.all([
    db().prepare(`SELECT hr_employee_id, period, amount, parts, replace_reason FROM hr_salaries WHERE hr_employee_id ${inIds}`).bind(...ids).all<SalaryRow & { hr_employee_id: number }>(),
    db().prepare("SELECT date, kind, name FROM hr_calendar WHERE date BETWEEN ? AND ?").bind(`${first.slice(0, 7)}-01`, addDays(addMonths(`${last.slice(0, 7)}-01`, 2), -1)).all<CalendarDay>(),
    db().prepare(`SELECT id, hr_employee_id, kind, start_date, end_date, days, order_no FROM hr_leaves WHERE hr_employee_id ${inIds} AND end_date >= ?`).bind(...ids, addMonths(first, -40)).all<HrLeaveCalc & { hr_employee_id: number }>(),
    getHrParams(),
  ]);
  const index = indexCalendar(calendar.results);
  return paid.flatMap((l) => {
    const emp = employees.find((e) => e.id === l.hr_employee_id);
    if (!emp) return [];
    const result = leavePay({ emp, kind: l.kind, start: l.start_date, end: l.end_date, calendar: index, params,
      salaries: salaries.results.filter((x: SalaryRow & { hr_employee_id: number }) => x.hr_employee_id === l.hr_employee_id), leaves: history.results.filter((h: HrLeaveCalc & { hr_employee_id: number }) => h.hr_employee_id === l.hr_employee_id) });
    const month = result?.months.find((m) => m.period === period);
    if (!result || !month) return [];
    return [{ hr_employee_id: l.hr_employee_id, order_no: l.order_no, kind: l.kind, days: month.paidDays, daily: result.daily ?? 0, amount: month.amount, averageMonths: result.average.months,
      start: l.start_date, end: l.end_date, total: result.total, applied: result.applied, difference: result.difference, complete: result.complete, warnings: result.warnings }];
  });
}

// Versiya 3.60: the severance on liquidation or redundancy is free of income tax (Vergi Məcəlləsi 102.1.4) and of DSMF ("Sosial sığorta haqqında" 15).
const SEVERANCE_LABEL = "İşdən çıxma müavinəti";
const SEVERANCE_EXEMPT_REASONS = ["liquidation", "reduction"];

// Signed termination orders dated in the month: what the settlement adds to the month's pay besides the salary of the worked days.
async function settlementPayOf(employees: Employee[], period: string) {
  if (!employees.length) return [] as SettlementPay[];
  const from = `${period}-01`, to = monthEnd(from);
  const ids = employees.map((e) => e.id);
  const orders = (await db().prepare(`SELECT hr_employee_id, order_no, start_date, kind, extra FROM hr_orders WHERE grp = 'termination' AND status = 'signed' AND start_date BETWEEN ? AND ? AND hr_employee_id IN (${ids.map(() => "?").join(",")})`)
    .bind(from, to, ...ids).all<{ hr_employee_id: number; order_no: string | null; start_date: string; kind: string | null; extra: string | null }>()).results;
  return orders.flatMap((o) => {
    const snapshot = json<{ settlement?: { lines?: { label: string; amount: number }[] } }>(o.extra, {}).settlement;
    const lines = (snapshot?.lines || []).slice(1).filter((l) => Number(l.amount)).map((l) => ({ label: l.label, amount: round2(Number(l.amount)) }));
    if (!lines.length) return [];
    const exempt = SEVERANCE_EXEMPT_REASONS.includes(String(o.kind)) ? round2(lines.filter((l) => l.label === SEVERANCE_LABEL).reduce((sum, l) => sum + l.amount, 0)) : 0;
    return [{ hr_employee_id: o.hr_employee_id, order_no: o.order_no, date: o.start_date, amount: round2(lines.reduce((sum, l) => sum + l.amount, 0)), exempt, lines }];
  });
}

export async function getPayrollMonth(companyId: number, period: string, access: PayrollAccess) {
  const month = await loadMonth(companyId, period, access);
  if (!access.payView) return { ...month, leavePay: [], settlementPay: [], inputs: [] };
  const ids = month.employees.map((e) => e.id);
  const inputs = ids.length ? (await db().prepare(`SELECT hr_employee_id, data FROM hr_payroll_inputs WHERE period = ? AND hr_employee_id IN (${ids.map(() => "?").join(",")})`).bind(period, ...ids).all<{ hr_employee_id: number; data: string }>()).results : [];
  return {
    ...month,
    leavePay: await leavePayOf(month.employees, month.leaves, period),
    settlementPay: await settlementPayOf(month.employees, period),
    inputs: inputs.map((r) => ({ hr_employee_id: r.hr_employee_id, ...EMPTY_INPUTS, ...json<Partial<PayrollInputs>>(r.data, {}) })),
  };
}

async function payrollStatus(companyId: number, period: string) {
  return (await db().prepare("SELECT status FROM hr_payrolls WHERE company_id = ? AND period = ?").bind(companyId, period).first<{ status: string }>())?.status || "draft";
}
async function sheetStatus(companyId: number, period: string, department: string) {
  return (await db().prepare("SELECT status FROM hr_timesheets WHERE company_id = ? AND period = ? AND department = ?").bind(companyId, period, department).first<{ status: string }>())?.status || "draft";
}

// A department's tabel may be changed: by its head while it is a draft or sent back, by the payroll accountant until it is accepted;
// never once the month's payroll is approved.
async function requireEditable(companyId: number, period: string, department: string, access: PayrollAccess) {
  if (await payrollStatus(companyId, period) === "approved") throw new Error("Bu ayın əməkhaqqı cədvəli təsdiqlənib — tabel dəyişdirilə bilməz.");
  const status = await sheetStatus(companyId, period, department);
  if (status === "accepted") throw new Error(`"${department || "Şöbə göstərilməyib"}" şöbəsinin tabeli qəbul edilib — dəyişmək üçün əvvəlcə qəbulu ləğv edin.`);
  if (access.editAll) return;
  if (!access.heads.includes(department)) throw new Error("FORBIDDEN");
  if (status === "submitted") throw new Error("Tabel artıq təqdim edilib — mühasibatlıq geri qaytarmasa, dəyişdirilə bilməz.");
}

export async function saveTimesheetMarks(user: { name: string }, companyId: number, period: string, rows: unknown, access: PayrollAccess) {
  await ensurePayrollSchema();
  if (!Array.isArray(rows) || !rows.length) return;
  const employees = new Map((await monthEmployees(companyId, period, access)).map((e) => [e.id, e]));
  const params = await getHrParams();
  const from = `${period}-01`, to = monthEnd(from);
  const calendar = indexCalendar((await db().prepare("SELECT date, kind, name FROM hr_calendar WHERE date BETWEEN ? AND ?").bind(from, to).all<CalendarDay>()).results);
  const checked = new Set<string>();
  const statements = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const emp = employees.get(Number(raw.hrEmployeeId));
    if (!emp) throw new Error("İşçi bu ayın tabelində yoxdur.");
    const department = dept(emp.department);
    if (!checked.has(department)) { await requireEditable(companyId, period, department, access); checked.add(department); }
    const leaves = (await db().prepare("SELECT hr_employee_id, kind, start_date, end_date FROM hr_leaves WHERE hr_employee_id = ? AND start_date <= ? AND end_date >= ?").bind(emp.id, to, from).all<Leave>()).results;
    const marks: Record<string, string> = {};
    for (const [day, value] of Object.entries((raw.marks || {}) as Record<string, unknown>)) {
      if (!/^\d{2}$/.test(day) || Number(day) < 1 || `${period}-${day}` > to) continue;
      const mark = normalizeMark(value);
      if (mark === null) throw new Error(`${emp.last_name} ${emp.first_name}, ${Number(day)}-ci gün: "${String(value)}" yazıla bilməz — saat (0–24) və ya E, Q, X, İ yazın.`);
      if (mark) marks[day] = mark;
    }
    // Days fixed by a leave (or outside employment) keep their value whatever was sent.
    const row = timesheetRow(emp, period, leaves, marks, calendar, params);
    const kept = Object.fromEntries(row.cells.filter((c) => c.manual).map((c) => [c.date.slice(8), c.value]));
    const overtime: Record<string, number> = {};
    for (const [day, value] of Object.entries((raw.overtime || {}) as Record<string, unknown>)) {
      if (!/^\d{2}$/.test(day) || `${period}-${day}` > to) continue;
      const hours = normalizeOvertime(value);
      if (hours === null) throw new Error(`${emp.last_name} ${emp.first_name}, ${Number(day)}-ci gün: əlavə saat 0–24 arası olmalıdır.`);
      if (hours) overtime[day] = hours;
    }
    statements.push(db().prepare(`INSERT INTO hr_timesheet_marks (hr_employee_id, period, marks, overtime, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(hr_employee_id, period) DO UPDATE SET marks = excluded.marks, overtime = excluded.overtime, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(emp.id, period, JSON.stringify(kept), JSON.stringify(overtime), user.name, new Date().toISOString()));
  }
  if (statements.length) await db().batch(statements);
}

// Hand in (head), accept / send back / reopen (payroll accountant).
export async function setTimesheetStatus(user: { name: string }, companyId: number, period: string, department: string, action: string, note: unknown, access: PayrollAccess) {
  await ensurePayrollSchema();
  const status = await sheetStatus(companyId, period, department);
  const approved = await payrollStatus(companyId, period) === "approved";
  if (approved) throw new Error("Bu ayın əməkhaqqı cədvəli təsdiqlənib — tabelin vəziyyəti dəyişdirilə bilməz.");
  const now = new Date().toISOString();
  let next: string;
  if (action === "submit") {
    if (!access.editAll && !access.heads.includes(department)) throw new Error("FORBIDDEN");
    if (status === "submitted" || status === "accepted") throw new Error("Tabel artıq təqdim edilib.");
    next = "submitted";
  } else {
    if (!access.editAll) throw new Error("FORBIDDEN");
    if (action === "accept") { if (status === "accepted") throw new Error("Tabel artıq qəbul edilib."); next = "accepted"; }
    else if (action === "return") {
      if (status !== "submitted" && status !== "accepted") throw new Error("Yalnız təqdim edilmiş tabel geri qaytarılır.");
      if (!String(note ?? "").trim()) throw new Error("Geri qaytarmanın səbəbini yazın.");
      next = "returned";
    } else if (action === "reopen") { if (status !== "accepted") throw new Error("Tabel qəbul edilməyib."); next = "submitted"; }
    else throw new Error("Əməliyyat seçilməyib.");
  }
  const submitted = action === "submit";
  await db().prepare(`INSERT INTO hr_timesheets (company_id, period, department, status, submitted_by, submitted_at, decided_by, decided_at, return_note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, period, department) DO UPDATE SET status = excluded.status, submitted_by = COALESCE(excluded.submitted_by, hr_timesheets.submitted_by), submitted_at = COALESCE(excluded.submitted_at, hr_timesheets.submitted_at),
      decided_by = excluded.decided_by, decided_at = excluded.decided_at, return_note = excluded.return_note, updated_at = excluded.updated_at`)
    .bind(companyId, period, department, next, submitted ? user.name : null, submitted ? now : null, submitted ? null : user.name, submitted ? null : now, action === "return" ? String(note).trim() : null, now).run();
}

export async function savePayrollInputs(companyId: number, period: string, rows: unknown, access: PayrollAccess) {
  await ensurePayrollSchema();
  if (!access.payEdit) throw new Error("FORBIDDEN");
  if (await payrollStatus(companyId, period) === "approved") throw new Error("Əməkhaqqı cədvəli təsdiqlənib — əvvəlcə təsdiqi ləğv edin.");
  if (!Array.isArray(rows)) return;
  const ids = new Set((await monthEmployees(companyId, period, access)).map((e) => e.id));
  const statements = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const id = Number(raw.hrEmployeeId);
    if (!ids.has(id)) throw new Error("İşçi bu ayın cədvəlində yoxdur.");
    const data: PayrollInputs = { ...EMPTY_INPUTS, note: String(raw.note ?? "").trim().slice(0, 300) };
    for (const key of PAYROLL_INPUT_KEYS) data[key] = money(raw[key]);
    statements.push(db().prepare("INSERT INTO hr_payroll_inputs (hr_employee_id, period, data) VALUES (?, ?, ?) ON CONFLICT(hr_employee_id, period) DO UPDATE SET data = excluded.data").bind(id, period, JSON.stringify(data)));
  }
  if (statements.length) await db().batch(statements);
}

// Approving needs every department's tabel accepted. The computed rows are kept with the payroll (later changes to cards or
// the calendar do not alter an approved month), and each worker's earnings that count towards the average for leave go to the
// card's Əmək haqqı for that month — the average earnings of later leaves and the final settlement are worked out from it.
export async function setPayrollStatus(user: { name: string }, companyId: number, period: string, approve: boolean, access: PayrollAccess) {
  await ensurePayrollSchema();
  if (!access.payEdit || !access.allDepartments) throw new Error("FORBIDDEN");
  const current = await payrollStatus(companyId, period);
  if (!approve) {
    if (current !== "approved") throw new Error("Əməkhaqqı cədvəli təsdiqlənməyib.");
    await db().prepare("UPDATE hr_payrolls SET status = 'draft', approved_by = NULL, approved_at = NULL, snapshot = NULL WHERE company_id = ? AND period = ?").bind(companyId, period).run();
    return;
  }
  if (current === "approved") throw new Error("Əməkhaqqı cədvəli artıq təsdiqlənib.");
  const month = await getPayrollMonth(companyId, period, access);
  if (!month.employees.length) throw new Error("Bu ayda firmada işləyən işçi yoxdur.");
  const open = month.departments.filter((d) => d.status !== "accepted");
  if (open.length) throw new Error(`Bütün şöbələrin tabeli qəbul edilməlidir. Qəbul edilməyib: ${open.map((d) => d.department || "Şöbə göstərilməyib").join(", ")}.`);
  const calendar = indexCalendar(month.calendar);
  const rows = month.employees.map((emp) => {
    const stored = month.marks.find((m) => m.hr_employee_id === emp.id);
    const row = timesheetRow(emp, period, month.leaves, stored?.marks || {}, calendar, month.params);
    const inputs = month.inputs.find((i) => i.hr_employee_id === emp.id) || EMPTY_INPUTS;
    const leavePay = month.leavePay.filter((l) => l.hr_employee_id === emp.id);
    const settlement = month.settlementPay.filter((s) => s.hr_employee_id === emp.id);
    const pay = payrollRow({ salary: emp.monthly_salary ?? null, period, row, overtime: overtimeHours(stored?.overtime || {}), leavePay, settlement, inputs, jobKind: emp.job_kind, sector: month.params.payrollSector });
    return { hr_employee_id: emp.id, name: [emp.last_name, emp.first_name, emp.patronymic].filter(Boolean).join(" "), fin: emp.fin || null, jobKind: emp.job_kind === "additional" ? "additional" : "main", position: emp.position, department: dept(emp.department), workedDays: row.workedDays, normDays: row.norm.days, workedHours: row.workedHours, normHours: row.norm.hours, overtime: overtimeHours(stored?.overtime || {}), inputs, leaveDetails: leavePay, settlementDetails: settlement, ...pay };
  });
  const now = new Date().toISOString();
  await db().batch([
    db().prepare(`INSERT INTO hr_payrolls (company_id, period, status, approved_by, approved_at, snapshot) VALUES (?, ?, 'approved', ?, ?, ?)
      ON CONFLICT(company_id, period) DO UPDATE SET status = 'approved', approved_by = excluded.approved_by, approved_at = excluded.approved_at, snapshot = excluded.snapshot`).bind(companyId, period, user.name, now, JSON.stringify(rows)),
    // Versiya 3.60: the card gets what counts towards the average for leave (not the whole gross) and the month's make-up; a reason
    // the month is replaced (140.1), entered on the card, is kept.
    ...rows.map((r) => db().prepare("INSERT INTO hr_salaries (hr_employee_id, period, amount, parts) VALUES (?, ?, ?, ?) ON CONFLICT(hr_employee_id, period) DO UPDATE SET amount = excluded.amount, parts = excluded.parts").bind(r.hr_employee_id, period, r.included, JSON.stringify(r.parts))),
  ]);
}

// The firm's name for the Əməliyyat jurnalı.
export async function companyLabel(companyId: number) {
  const row = await db().prepare("SELECT name FROM companies WHERE id = ?").bind(companyId).first<{ name: string }>();
  return row?.name || `#${companyId}`;
}
