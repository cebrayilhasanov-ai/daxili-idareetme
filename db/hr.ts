import { env } from "@/lib/runtime";
import { CALENDAR_KINDS, LEAVE_KINDS, addMonths, isIsoDate, leaveDaysBetween, indexCalendar, monthStart, normalizeParams, suggestedHolidays, todayIso, type CalendarDay, type HrParams } from "@/lib/hr-calc";

// HR register (kadr uçotu): every worker of every firm, kept apart from the app's login users (`employees` / `app_users`).
// Most workers never sign in; a card may optionally point at a Personal entry (user_employee_id) when that person also uses the app.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

let schemaReady = false;
async function ensureHrSchema() {
  if (schemaReady) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_id INTEGER,
    department TEXT,
    position TEXT,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    patronymic TEXT,
    fin TEXT,
    id_series TEXT,
    id_number TEXT,
    id_issued_by TEXT,
    id_issued_at TEXT,
    id_valid_until TEXT,
    birth_date TEXT,
    gender TEXT,
    reg_address TEXT,
    phone TEXT,
    id_front_key TEXT,
    id_front_name TEXT,
    id_back_key TEXT,
    id_back_name TEXT,
    hire_date TEXT NOT NULL,
    termination_date TEXT,
    termination_reason TEXT,
    prior_experience_months INTEGER NOT NULL DEFAULT 0,
    base_leave_days INTEGER,
    extra_leave_days INTEGER NOT NULL DEFAULT 0,
    extra_leave_note TEXT,
    work_week INTEGER NOT NULL DEFAULT 5,
    monthly_salary REAL,
    opening_balance_date TEXT,
    opening_balance_days REAL,
    user_employee_id INTEGER,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`).run();
  await db().prepare("CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_fin ON hr_employees(fin) WHERE fin IS NOT NULL AND fin != ''").run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL,
    order_no TEXT,
    order_date TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    amount REAL NOT NULL,
    UNIQUE(hr_employee_id, period)
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_calendar (
    date TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    name TEXT
  )`).run();
  await db().prepare("CREATE TABLE IF NOT EXISTS hr_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT)").run();
  schemaReady = true;
}

const text = (value: unknown) => { const v = String(value ?? "").trim(); return v || null; };
const date = (value: unknown, label: string) => {
  const v = text(value);
  if (!v) return null;
  if (!isIsoDate(v)) throw new Error(`${label} düzgün tarix deyil.`);
  return v;
};
const number = (value: unknown, label: string) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const v = Number(String(value).replace(",", "."));
  if (!Number.isFinite(v) || v < 0) throw new Error(`${label} düzgün rəqəm deyil.`);
  return v;
};

export async function getHrParams(): Promise<HrParams> {
  await ensureHrSchema();
  const row = await db().prepare("SELECT value FROM hr_settings WHERE key = 'params'").first<{ value: string | null }>();
  try { return normalizeParams(row?.value ? JSON.parse(row.value) : {}); } catch { return normalizeParams({}); }
}

export async function saveHrParams(raw: unknown) {
  await ensureHrSchema();
  const params = normalizeParams(raw);
  await db().prepare("INSERT INTO hr_settings (key, value) VALUES ('params', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(params)).run();
}

async function calendarDays(): Promise<CalendarDay[]> {
  return (await db().prepare("SELECT date, kind, name FROM hr_calendar ORDER BY date").all<CalendarDay>()).results;
}

export async function getHrData() {
  await ensureHrSchema();
  const [employees, leaves, salaries, calendar, params, companies, users] = await Promise.all([
    db().prepare(`SELECT hr_employees.*, companies.name AS company_name, employees.name AS user_employee_name FROM hr_employees
      LEFT JOIN companies ON companies.id = hr_employees.company_id
      LEFT JOIN employees ON employees.id = hr_employees.user_employee_id
      ORDER BY hr_employees.last_name, hr_employees.first_name`).all(),
    db().prepare("SELECT * FROM hr_leaves ORDER BY start_date DESC, id DESC").all(),
    db().prepare("SELECT hr_employee_id, period, amount FROM hr_salaries ORDER BY period").all(),
    calendarDays(),
    getHrParams(),
    db().prepare("SELECT id, name FROM companies WHERE active = 1 ORDER BY name").all(),
    db().prepare("SELECT id, name FROM employees WHERE active = 1 ORDER BY name").all(),
  ]);
  // Departments and positions come from each firm's structure (Firmalar → Struktur); the table may not exist on a fresh database.
  let structure: { company_id: number; department: string; title: string }[] = [];
  try { structure = (await db().prepare("SELECT company_id, department, title FROM company_structure_positions ORDER BY sort_order, id").all<{ company_id: number; department: string; title: string }>()).results; } catch { structure = []; }
  return { employees: employees.results, leaves: leaves.results, salaries: salaries.results, calendar, params, companies: companies.results, users: users.results, structure };
}

export async function saveHrEmployee(input: Record<string, unknown>) {
  await ensureHrSchema();
  const id = Number(input.id) || null;
  const lastName = text(input.lastName), firstName = text(input.firstName);
  if (!lastName || !firstName) throw new Error("Soyad və ad daxil edin.");
  const hireDate = date(input.hireDate, "İşə qəbul tarixi");
  if (!hireDate) throw new Error("İşə qəbul tarixini daxil edin.");
  const fin = text(input.fin)?.toUpperCase() || null;
  if (fin && !/^[A-Z0-9]{7}$/.test(fin)) throw new Error("FİN 7 simvol (latın hərfi və rəqəm) olmalıdır.");
  if (fin) {
    const same = await db().prepare("SELECT id, last_name, first_name FROM hr_employees WHERE fin = ? AND id != ?").bind(fin, id || 0).first<{ id: number; last_name: string; first_name: string }>();
    if (same) throw new Error(`Bu FİN artıq ${same.last_name} ${same.first_name} adlı işçidə qeydə alınıb.`);
  }
  const terminationDate = date(input.terminationDate, "İşdən çıxma tarixi");
  if (terminationDate && terminationDate < hireDate) throw new Error("İşdən çıxma tarixi işə qəbul tarixindən əvvəl ola bilməz.");
  const openingDate = date(input.openingBalanceDate, "Başlanğıc qalığın tarixi");
  const openingDays = input.openingBalanceDays === null || input.openingBalanceDays === undefined || String(input.openingBalanceDays).trim() === "" ? null : Number(String(input.openingBalanceDays).replace(",", "."));
  if (openingDays !== null && !Number.isFinite(openingDays)) throw new Error("Başlanğıc qalıq düzgün rəqəm deyil.");
  if ((openingDate === null) !== (openingDays === null)) throw new Error("Başlanğıc qalıq üçün həm tarixi, həm gün sayını daxil edin.");
  const workWeek = Number(input.workWeek) === 6 ? 6 : 5;
  const values = [
    Number(input.companyId) || null, text(input.department), text(input.position), lastName, firstName, text(input.patronymic),
    fin, text(input.idSeries)?.toUpperCase() || null, text(input.idNumber), text(input.idIssuedBy), date(input.idIssuedAt, "Vəsiqənin verilmə tarixi"), date(input.idValidUntil, "Vəsiqənin etibarlılıq tarixi"),
    date(input.birthDate, "Doğum tarixi"), text(input.gender), text(input.regAddress), text(input.phone),
    text(input.idFrontKey), text(input.idFrontName), text(input.idBackKey), text(input.idBackName),
    hireDate, terminationDate, terminationDate ? text(input.terminationReason) : null,
    Math.round(number(input.priorExperienceMonths, "Əvvəlki staj") || 0), number(input.baseLeaveDays, "Əsas məzuniyyət günü"), Math.round(number(input.extraLeaveDays, "Əlavə məzuniyyət günü") || 0), text(input.extraLeaveNote),
    workWeek, number(input.monthlySalary, "Vəzifə maaşı"), openingDate, openingDays, Number(input.userEmployeeId) || null, text(input.note),
  ];
  const columns = "company_id, department, position, last_name, first_name, patronymic, fin, id_series, id_number, id_issued_by, id_issued_at, id_valid_until, birth_date, gender, reg_address, phone, id_front_key, id_front_name, id_back_key, id_back_name, hire_date, termination_date, termination_reason, prior_experience_months, base_leave_days, extra_leave_days, extra_leave_note, work_week, monthly_salary, opening_balance_date, opening_balance_days, user_employee_id, note";
  const now = new Date().toISOString();
  if (id) {
    const sets = columns.split(", ").map((c) => `${c} = ?`).join(", ");
    await db().prepare(`UPDATE hr_employees SET ${sets}, updated_at = ? WHERE id = ?`).bind(...values, now, id).run();
    return id;
  }
  const result = await db().prepare(`INSERT INTO hr_employees (${columns}, created_at) VALUES (${values.map(() => "?").join(", ")}, ?)`).bind(...values, now).run();
  return Number(result.meta.last_row_id);
}

export async function hrEmployeeLabel(id: number) {
  await ensureHrSchema();
  const row = await db().prepare("SELECT last_name, first_name FROM hr_employees WHERE id = ?").bind(id).first<{ last_name: string; first_name: string }>();
  return row ? `${row.last_name} ${row.first_name}` : `#${id}`;
}

export async function deleteHrEmployee(id: number) {
  await ensureHrSchema();
  await db().batch([
    db().prepare("DELETE FROM hr_leaves WHERE hr_employee_id = ?").bind(id),
    db().prepare("DELETE FROM hr_salaries WHERE hr_employee_id = ?").bind(id),
    db().prepare("DELETE FROM hr_employees WHERE id = ?").bind(id),
  ]);
}

export async function saveHrLeave(input: Record<string, unknown>) {
  await ensureHrSchema();
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçi seçilməyib.");
  const kind = String(input.kind || "");
  if (!LEAVE_KINDS.some((k) => k.key === kind)) throw new Error("Məzuniyyətin növünü seçin.");
  const start = date(input.startDate, "Başlama tarixi"), end = date(input.endDate, "Bitmə tarixi");
  if (!start || !end) throw new Error("Başlama və bitmə tarixlərini daxil edin.");
  if (end < start) throw new Error("Bitmə tarixi başlama tarixindən əvvəl ola bilməz.");
  // Days are worked out from the production calendar unless HR typed a different figure (e.g. a sick note moved the leave).
  const typed = number(input.days, "Gün sayı");
  const days = typed ?? leaveDaysBetween(start, end, indexCalendar(await calendarDays()), await getHrParams());
  const values = [employeeId, kind, start, end, days, text(input.orderNo), date(input.orderDate, "Əmrin tarixi"), text(input.note)];
  const id = Number(input.id) || null;
  if (id) await db().prepare("UPDATE hr_leaves SET hr_employee_id = ?, kind = ?, start_date = ?, end_date = ?, days = ?, order_no = ?, order_date = ?, note = ? WHERE id = ?").bind(...values, id).run();
  else await db().prepare("INSERT INTO hr_leaves (hr_employee_id, kind, start_date, end_date, days, order_no, order_date, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...values, new Date().toISOString()).run();
}

export async function deleteHrLeave(id: number) {
  await ensureHrSchema();
  await db().prepare("DELETE FROM hr_leaves WHERE id = ?").bind(id).run();
}

export async function saveHrSalary(input: Record<string, unknown>) {
  await ensureHrSchema();
  const employeeId = Number(input.hrEmployeeId);
  const period = String(input.period || "");
  if (!employeeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("İşçi və ay düzgün seçilməyib.");
  const amount = number(input.amount, "Məbləğ");
  if (amount === null) await db().prepare("DELETE FROM hr_salaries WHERE hr_employee_id = ? AND period = ?").bind(employeeId, period).run();
  else await db().prepare("INSERT INTO hr_salaries (hr_employee_id, period, amount) VALUES (?, ?, ?) ON CONFLICT(hr_employee_id, period) DO UPDATE SET amount = excluded.amount").bind(employeeId, period, amount).run();
}

// Fills the months with no amount yet (within the last `months`, never before the hire month) with the position salary.
export async function fillHrSalaries(employeeId: number, months: number) {
  await ensureHrSchema();
  const emp = await db().prepare("SELECT hire_date, monthly_salary FROM hr_employees WHERE id = ?").bind(employeeId).first<{ hire_date: string; monthly_salary: number | null }>();
  if (!emp?.monthly_salary) throw new Error("Əvvəlcə işçinin vəzifə maaşını daxil edin.");
  const current = monthStart(todayIso());
  const statements = [];
  for (let i = 1; i <= months; i++) {
    const period = addMonths(current, -i).slice(0, 7);
    if (period < emp.hire_date.slice(0, 7)) break;
    statements.push(db().prepare("INSERT OR IGNORE INTO hr_salaries (hr_employee_id, period, amount) VALUES (?, ?, ?)").bind(employeeId, period, emp.monthly_salary));
  }
  if (statements.length) await db().batch(statements);
}

export async function saveHrCalendarDay(input: Record<string, unknown>) {
  await ensureHrSchema();
  const day = date(input.date, "Tarix");
  const kind = String(input.kind || "");
  if (!day) throw new Error("Tarixi daxil edin.");
  if (!CALENDAR_KINDS.some((k) => k.key === kind)) throw new Error("Günün növünü seçin.");
  await db().prepare("INSERT INTO hr_calendar (date, kind, name) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, name = excluded.name").bind(day, kind, text(input.name)).run();
}

export async function deleteHrCalendarDay(day: string) {
  await ensureHrSchema();
  await db().prepare("DELETE FROM hr_calendar WHERE date = ?").bind(day).run();
}

// Adds the suggested holidays of a year without touching days HR has already entered.
export async function seedHrCalendar(year: number) {
  await ensureHrSchema();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("İl düzgün deyil.");
  await db().batch(suggestedHolidays(year).map((d) => db().prepare("INSERT OR IGNORE INTO hr_calendar (date, kind, name) VALUES (?, ?, ?)").bind(d.date, d.kind, d.name)));
}
