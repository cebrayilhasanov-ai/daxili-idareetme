import { env } from "@/lib/runtime";
import { createCustomer, findCustomerByVoen, getCustomers } from "@/db/catalog";
import { CALENDAR_KINDS, LEAVE_KINDS, TERMINATION_REASONS, addMonths, isIsoDate, leaveDaysBetween, indexCalendar, monthStart, EDUCATION_LEVELS, FAMILY_RELATIONS, MARITAL_STATUSES, normalizeParams, priorService, suggestedHolidays, todayIso, type CalendarDay, type HrParams } from "@/lib/hr-calc";

// HR register (kadr uçotu): every worker of every firm, kept apart from the app's login users (`employees` / `app_users`).
// Most workers never sign in; a card may optionally point at a Personal entry (user_employee_id) when that person also uses the app.

function db() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

// Columns added after the first version: photo, the leftover days of prior service, the employment contract and an emergency contact.
const EXTRA_COLUMNS: [string, string][] = [
  ["photo_key", "TEXT"], ["photo_name", "TEXT"], ["prior_experience_days", "INTEGER NOT NULL DEFAULT 0"],
  ["contract_no", "TEXT"], ["contract_date", "TEXT"], ["contract_type", "TEXT"], ["contract_end_date", "TEXT"], ["probation_months", "INTEGER"],
  ["hire_order_no", "TEXT"], ["hire_order_date", "TEXT"],
  ["emergency_name", "TEXT"], ["emergency_relation", "TEXT"], ["emergency_phone", "TEXT"], ["marital_status", "TEXT"],
];

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
  // Earlier employers: always a card in the customer list, so the customer report can show which of our people worked there.
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_prior_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    position TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db().prepare("CREATE INDEX IF NOT EXISTS hr_prior_jobs_customer ON hr_prior_jobs(customer_id)").run();
  const jobColumns = (await db().prepare("PRAGMA table_info(hr_prior_jobs)").all<{ name: string }>()).results;
  if (!jobColumns.some((c: { name: string }) => c.name === "termination_reason")) await db().prepare("ALTER TABLE hr_prior_jobs ADD COLUMN termination_reason TEXT").run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_family (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    relation TEXT NOT NULL,
    last_name TEXT,
    first_name TEXT NOT NULL,
    patronymic TEXT,
    birth_date TEXT,
    workplace TEXT,
    phone TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS hr_education (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hr_employee_id INTEGER NOT NULL,
    level TEXT NOT NULL,
    institution TEXT NOT NULL,
    specialty TEXT,
    start_year INTEGER,
    end_year INTEGER,
    diploma_no TEXT,
    diploma_key TEXT,
    diploma_name TEXT,
    created_at TEXT NOT NULL
  )`).run();
  const existing = new Set((await db().prepare("PRAGMA table_info(hr_employees)").all<{ name: string }>()).results.map((c: { name: string }) => c.name));
  const added = EXTRA_COLUMNS.filter(([name]) => !existing.has(name));
  if (added.length) await db().batch(added.map(([name, type]) => db().prepare(`ALTER TABLE hr_employees ADD COLUMN ${name} ${type}`)));
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
  // Loads the customer list first: that also creates its table, which the prior-jobs join below needs on a fresh database.
  const customers = (await getCustomers()) as { id: number; voen: string | null; name: string; country: string | null }[];
  const [employees, leaves, salaries, calendar, params, companies, users, priorJobs, family, education] = await Promise.all([
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
    db().prepare(`SELECT hr_prior_jobs.*, customers.name AS customer_name, customers.voen AS customer_voen FROM hr_prior_jobs
      LEFT JOIN customers ON customers.id = hr_prior_jobs.customer_id ORDER BY hr_prior_jobs.hr_employee_id, hr_prior_jobs.start_date`).all(),
    db().prepare("SELECT * FROM hr_family ORDER BY hr_employee_id, birth_date IS NULL, birth_date, id").all(),
    db().prepare("SELECT * FROM hr_education ORDER BY hr_employee_id, end_year IS NULL, end_year DESC, id").all(),
  ]);
  // Departments and positions come from each firm's structure (Firmalar → Struktur); the table may not exist on a fresh database.
  let structure: { company_id: number; department: string; title: string }[] = [];
  try { structure = (await db().prepare("SELECT company_id, department, title FROM company_structure_positions ORDER BY sort_order, id").all<{ company_id: number; department: string; title: string }>()).results; } catch { structure = []; }
  return { employees: employees.results, leaves: leaves.results, salaries: salaries.results, calendar, params, companies: companies.results, users: users.results, structure, priorJobs: priorJobs.results, family: family.results, education: education.results, customers: customers.map((c) => ({ id: c.id, voen: c.voen, name: c.name, country: c.country })) };
}

// Phone numbers: digits with an optional leading +, spaces, dashes and brackets, 9–15 digits in all.
function phoneValue(value: unknown, label: string, required: boolean) {
  const v = text(value);
  if (!v) { if (required) throw new Error(`${label} daxil edin.`); return null; }
  if (!/^\+?[\d\s()-]+$/.test(v)) throw new Error(`${label} yalnız rəqəm, boşluq, "+", "-" və mötərizədən ibarət ola bilər.`);
  const digits = v.replace(/\D/g, "").length;
  if (digits < 9 || digits > 15) throw new Error(`${label} 9–15 rəqəmdən ibarət olmalıdır.`);
  return v.replace(/\s+/g, " ");
}

type PriorJobInput = { customerId: number; position: string; startDate: string; endDate: string; terminationReason: string };
async function readPriorJobs(raw: unknown): Promise<PriorJobInput[]> {
  if (!Array.isArray(raw)) return [];
  const jobs: PriorJobInput[] = [];
  for (const [index, row] of raw.entries()) {
    const item = (row || {}) as Record<string, unknown>;
    const label = `Əvvəlki iş yeri ${index + 1}`;
    const customerId = Number(item.customerId);
    if (!customerId) throw new Error(`${label}: iş yerini müştəri siyahısından seçin.`);
    const position = text(item.position);
    if (!position) throw new Error(`${label}: vəzifəni yazın.`);
    const startDate = date(item.startDate, `${label}: başlama tarixi`), endDate = date(item.endDate, `${label}: bitmə tarixi`);
    if (!startDate || !endDate) throw new Error(`${label}: başlama və bitmə tarixlərini daxil edin.`);
    if (endDate < startDate) throw new Error(`${label}: bitmə tarixi başlama tarixindən əvvəl ola bilməz.`);
    if (endDate > todayIso()) throw new Error(`${label}: bitmə tarixi gələcəkdə ola bilməz.`);
    const terminationReason = String(item.terminationReason || "");
    if (!TERMINATION_REASONS.some((r) => r.key === terminationReason)) throw new Error(`${label}: işdən çıxma əsasını seçin.`);
    jobs.push({ customerId, position, startDate, endDate, terminationReason });
  }
  const ids = [...new Set(jobs.map((j) => j.customerId))];
  if (ids.length) {
    const found = await db().prepare(`SELECT id FROM customers WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).all<{ id: number }>();
    if (found.results.length !== ids.length) throw new Error("Seçilmiş iş yerlərindən biri müştəri siyahısında artıq yoxdur — yenidən seçin.");
  }
  return jobs;
}

export async function saveHrEmployee(input: Record<string, unknown>) {
  await ensureHrSchema();
  const id = Number(input.id) || null;
  const lastName = text(input.lastName), firstName = text(input.firstName);
  if (!lastName || !firstName) throw new Error("Soyad və ad daxil edin.");
  const phone = phoneValue(input.phone, "Telefon nömrəsini", true);
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
  const contractType = input.contractType === "fixed" || input.contractType === "indefinite" ? input.contractType : null;
  const contractDate = date(input.contractDate, "Müqavilənin tarixi");
  const contractEnd = contractType === "fixed" ? date(input.contractEndDate, "Müqavilənin bitmə tarixi") : null;
  if (contractType === "fixed" && !contractEnd) throw new Error("Müddətli müqavilənin bitmə tarixini daxil edin.");
  if (contractEnd && contractEnd < (contractDate || hireDate)) throw new Error("Müqavilənin bitmə tarixi başlama tarixindən əvvəl ola bilməz.");
  const probation = number(input.probationMonths, "Sınaq müddəti");
  if (probation !== null && (!Number.isInteger(probation) || probation > 3)) throw new Error("Sınaq müddəti 0–3 ay ola bilər.");
  const emergencyName = text(input.emergencyName);
  const emergencyPhone = phoneValue(input.emergencyPhone, "Təcili əlaqə şəxsinin telefonunu", Boolean(emergencyName));
  // With earlier employers listed, prior service is worked out from their dates; without them the typed figures are kept.
  const priorJobs = await readPriorJobs(input.priorJobs);
  const prior = priorJobs.length ? priorService(priorJobs.map((j) => ({ start_date: j.startDate, end_date: j.endDate }))) : null;
  const priorMonths = prior ? prior.totalMonths : Math.round(number(input.priorExperienceMonths, "Əvvəlki staj") || 0);
  const priorDays = prior ? prior.days : Math.round(number(input.priorExperienceDays, "Əvvəlki staj (gün)") || 0);
  if (!prior && priorDays > 29) throw new Error("Əvvəlki staj (gün) 0–29 arası olmalıdır — 30 gün 1 ay sayılır.");
  const values = [
    Number(input.companyId) || null, text(input.department), text(input.position), lastName, firstName, text(input.patronymic),
    fin, text(input.idSeries)?.toUpperCase() || null, text(input.idNumber), text(input.idIssuedBy), date(input.idIssuedAt, "Vəsiqənin verilmə tarixi"), date(input.idValidUntil, "Vəsiqənin etibarlılıq tarixi"),
    date(input.birthDate, "Doğum tarixi"), text(input.gender), text(input.regAddress), phone,
    text(input.idFrontKey), text(input.idFrontName), text(input.idBackKey), text(input.idBackName),
    hireDate, terminationDate, terminationDate ? text(input.terminationReason) : null,
    priorMonths, number(input.baseLeaveDays, "Əsas məzuniyyət günü"), Math.round(number(input.extraLeaveDays, "Əlavə məzuniyyət günü") || 0), text(input.extraLeaveNote),
    workWeek, number(input.monthlySalary, "Vəzifə maaşı"), openingDate, openingDays, Number(input.userEmployeeId) || null, text(input.note),
    text(input.photoKey), text(input.photoName), priorDays,
    text(input.contractNo), contractDate, contractType, contractEnd, probation,
    text(input.hireOrderNo), date(input.hireOrderDate, "İşə qəbul əmrinin tarixi"),
    emergencyName, text(input.emergencyRelation), emergencyPhone,
  ];
  const columns = "company_id, department, position, last_name, first_name, patronymic, fin, id_series, id_number, id_issued_by, id_issued_at, id_valid_until, birth_date, gender, reg_address, phone, id_front_key, id_front_name, id_back_key, id_back_name, hire_date, termination_date, termination_reason, prior_experience_months, base_leave_days, extra_leave_days, extra_leave_note, work_week, monthly_salary, opening_balance_date, opening_balance_days, user_employee_id, note, "
    + "photo_key, photo_name, prior_experience_days, contract_no, contract_date, contract_type, contract_end_date, probation_months, hire_order_no, hire_order_date, emergency_name, emergency_relation, emergency_phone";
  const now = new Date().toISOString();
  let savedId: number;
  if (id) {
    const sets = columns.split(", ").map((c) => `${c} = ?`).join(", ");
    await db().prepare(`UPDATE hr_employees SET ${sets}, updated_at = ? WHERE id = ?`).bind(...values, now, id).run();
    savedId = id;
  } else {
    const result = await db().prepare(`INSERT INTO hr_employees (${columns}, created_at) VALUES (${values.map(() => "?").join(", ")}, ?)`).bind(...values, now).run();
    savedId = Number(result.meta.last_row_id);
  }
  await db().batch([
    db().prepare("DELETE FROM hr_prior_jobs WHERE hr_employee_id = ?").bind(savedId),
    ...priorJobs.map((j, i) => db().prepare("INSERT INTO hr_prior_jobs (hr_employee_id, customer_id, position, start_date, end_date, termination_reason, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(savedId, j.customerId, j.position, j.startDate, j.endDate, j.terminationReason, i)),
  ]);
  return savedId;
}

// A new earlier employer typed in the HR card goes straight into the customer list (HR users may not have the Customers section).
export async function createHrCustomer(input: Record<string, unknown>) {
  await ensureHrSchema();
  const voen = text(input.voen);
  if (!voen) throw new Error("VÖEN daxil edin.");
  if (await findCustomerByVoen(voen)) throw new Error("Bu VÖEN artıq müştəri siyahısında var — siyahıdan seçin.");
  await createCustomer({ entityType: text(input.entityType) || undefined, voen, name: text(input.name) || "", legalAddress: text(input.legalAddress) || undefined, manager: text(input.manager) || undefined, phone: text(input.phone) || undefined });
  const created = await findCustomerByVoen(voen);
  if (!created) throw new Error("Müştəri yaradılmadı.");
  return created.id;
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
    db().prepare("DELETE FROM hr_prior_jobs WHERE hr_employee_id = ?").bind(id),
    db().prepare("DELETE FROM hr_family WHERE hr_employee_id = ?").bind(id),
    db().prepare("DELETE FROM hr_education WHERE hr_employee_id = ?").bind(id),
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

export async function saveHrMaritalStatus(input: Record<string, unknown>) {
  await ensureHrSchema();
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçi seçilməyib.");
  const status = text(input.maritalStatus);
  if (status && !MARITAL_STATUSES.includes(status)) throw new Error("Ailə vəziyyətini siyahıdan seçin.");
  await db().prepare("UPDATE hr_employees SET marital_status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), employeeId).run();
}

export async function saveHrFamilyMember(input: Record<string, unknown>) {
  await ensureHrSchema();
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçi seçilməyib.");
  const relation = text(input.relation);
  if (!relation || !FAMILY_RELATIONS.includes(relation)) throw new Error("Qohumluq dərəcəsini seçin.");
  const firstName = text(input.firstName);
  if (!firstName) throw new Error("Ailə üzvünün adını yazın.");
  const birthDate = date(input.birthDate, "Doğum tarixi");
  if (birthDate && birthDate > todayIso()) throw new Error("Doğum tarixi gələcəkdə ola bilməz.");
  const values = [employeeId, relation, text(input.lastName), firstName, text(input.patronymic), birthDate, text(input.workplace), phoneValue(input.phone, "Ailə üzvünün telefonunu", false)];
  const id = Number(input.id) || null;
  if (id) await db().prepare("UPDATE hr_family SET hr_employee_id = ?, relation = ?, last_name = ?, first_name = ?, patronymic = ?, birth_date = ?, workplace = ?, phone = ? WHERE id = ?").bind(...values, id).run();
  else await db().prepare("INSERT INTO hr_family (hr_employee_id, relation, last_name, first_name, patronymic, birth_date, workplace, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...values, new Date().toISOString()).run();
}

export async function saveHrEducation(input: Record<string, unknown>) {
  await ensureHrSchema();
  const employeeId = Number(input.hrEmployeeId);
  if (!employeeId) throw new Error("İşçi seçilməyib.");
  const level = text(input.level);
  if (!level || !EDUCATION_LEVELS.includes(level)) throw new Error("Təhsil səviyyəsini seçin.");
  const institution = text(input.institution);
  if (!institution) throw new Error("Təhsil müəssisəsini yazın.");
  const year = (value: unknown, label: string) => {
    const v = number(value, label);
    if (v === null) return null;
    if (!Number.isInteger(v) || v < 1940 || v > new Date().getFullYear() + 6) throw new Error(`${label} düzgün il deyil.`);
    return v;
  };
  const startYear = year(input.startYear, "Başlama ili"), endYear = year(input.endYear, "Bitmə ili");
  if (startYear && endYear && endYear < startYear) throw new Error("Bitmə ili başlama ilindən əvvəl ola bilməz.");
  const values = [employeeId, level, institution, text(input.specialty), startYear, endYear, text(input.diplomaNo), text(input.diplomaKey), text(input.diplomaName)];
  const id = Number(input.id) || null;
  if (id) await db().prepare("UPDATE hr_education SET hr_employee_id = ?, level = ?, institution = ?, specialty = ?, start_year = ?, end_year = ?, diploma_no = ?, diploma_key = ?, diploma_name = ? WHERE id = ?").bind(...values, id).run();
  else await db().prepare("INSERT INTO hr_education (hr_employee_id, level, institution, specialty, start_year, end_year, diploma_no, diploma_key, diploma_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...values, new Date().toISOString()).run();
}

export async function deleteHrFamilyMember(id: number) {
  await ensureHrSchema();
  await db().prepare("DELETE FROM hr_family WHERE id = ?").bind(id).run();
}

export async function deleteHrEducation(id: number) {
  await ensureHrSchema();
  await db().prepare("DELETE FROM hr_education WHERE id = ?").bind(id).run();
}

// Customer report, only for users who may see personnel data: which of our people worked at each customer and what they do now.
export async function getHrCustomerReport() {
  await ensureHrSchema();
  return (await db().prepare(`SELECT hr_prior_jobs.customer_id, hr_prior_jobs.position AS prior_position, hr_prior_jobs.start_date, hr_prior_jobs.end_date, hr_prior_jobs.termination_reason AS prior_termination_reason,
      hr_employees.id AS hr_employee_id, hr_employees.last_name, hr_employees.first_name, hr_employees.patronymic, hr_employees.position AS current_position,
      hr_employees.termination_date, companies.name AS company_name
    FROM hr_prior_jobs JOIN hr_employees ON hr_employees.id = hr_prior_jobs.hr_employee_id LEFT JOIN companies ON companies.id = hr_employees.company_id
    ORDER BY hr_prior_jobs.customer_id, hr_prior_jobs.end_date DESC`).all()).results;
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
