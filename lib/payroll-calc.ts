import { Dec } from "@/lib/decimal";
import { addDays, isWorkingDay, monthEnd, round2, workNorm, type CalendarIndex, type EarningPart, type HrParams, type PayrollSector } from "@/lib/hr-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54): the monthly time sheet (İş vaxtının uçot tabeli, form N-1t) and the payroll
// (Hesablama-ödəmə cədvəli) worked out from it. Shared by the API and the page, so both show the same figures.
// Each day of the tabel is filled from the production calendar and the worker's leaves (signed leave orders, sick notes);
// a department head writes only what differs (a shorter day, ezamiyyət, absence). Leave days cannot be overwritten — they
// follow the order. The payroll takes the card salary × worked days / norm days, overtime from the separate overtime tabel,
// leave pay from the leave orders (split by month: each month gets the pay of its own leave days and is taxed in that month),
// and the 2026–2028 private non-oil sector rates. The rates are a first version, to be checked against the accountant's rules.
// Versiya 3.56 (the firm's own Excel payroll): the salary part is card salary / the month's norm hours × the hours worked;
// a worker whose job here is an additional one (əvəzçilik) gets no 200 ₼ income tax exemption; the final settlement of a
// worker dismissed in the month (leave compensation, severance) comes from the signed termination order; the advance and the
// alimony are taken from what is payable after tax.

export type DayCode = "İ" | "B" | "M" | "Ö" | "S" | "T" | "X" | "E" | "Q" | "—";
export const DAY_CODES: { code: DayCode; label: string }[] = [
  { code: "İ", label: "İstirahət günü" },
  { code: "B", label: "Bayram günü" },
  { code: "M", label: "Əmək məzuniyyəti" },
  { code: "Ö", label: "Ödənişsiz məzuniyyət" },
  { code: "S", label: "Sosial məzuniyyət" },
  { code: "T", label: "Təhsil məzuniyyəti" },
  { code: "X", label: "Xəstəlik" },
  { code: "E", label: "Ezamiyyət" },
  { code: "Q", label: "Səbəbsiz işə gəlməmə" },
  { code: "—", label: "İşdə deyil (qəbuldan əvvəl / çıxdıqdan sonra)" },
];
// What a head may write in a day: hours (0–24) or one of these codes. Leaves come only from orders and sick notes.
export const MANUAL_CODES: DayCode[] = ["E", "Q", "X", "İ"];
export const LEAVE_CODE: Record<string, DayCode> = { annual: "M", unpaid: "Ö", social: "S", study: "T", other: "M", sick: "X" };
// Leave kinds paid from the average earnings in the payroll; social leave (e.g. maternity) is paid by DSMF, not here.
export const PAID_LEAVE_KINDS = ["annual", "study", "other"];

export type TimesheetEmployee = { id: number; hire_date: string; termination_date: string | null; work_week: number };
export type TimesheetLeave = { hr_employee_id: number; kind: string; start_date: string; end_date: string };
export type DayCell = { date: string; value: string; auto: string; locked: boolean; manual: boolean };

export const periodDays = (period: string) => {
  const days: string[] = [];
  for (let d = `${period}-01`; d <= monthEnd(`${period}-01`); d = addDays(d, 1)) days.push(d);
  return days;
};
export const dayHours = (date: string, calendar: CalendarIndex, workWeek: number, params: HrParams) =>
  round2((workWeek === 6 ? (params.dailyHours * 5) / 6 : params.dailyHours) - (calendar.get(date)?.kind === "short" ? 1 : 0));
export const isHours = (value: string) => /^\d+([.,]\d+)?$/.test(value);
export const hoursOf = (value: string) => (isHours(value) ? Number(value.replace(",", ".")) : 0);

// A typed day → its stored form, or null when it is not allowed ("" clears the day back to its automatic value).
export function normalizeMark(raw: unknown): string | null {
  const value = String(raw ?? "").trim().toLocaleUpperCase("az").replace(",", ".");
  if (!value) return "";
  if (isHours(value)) { const n = Number(value); return n >= 0 && n <= 24 ? String(round2(n)) : null; }
  const code = value === "I" ? "İ" : value;
  return (MANUAL_CODES as string[]).includes(code) ? code : null;
}

// The value a day gets by itself: not employed, a leave, a holiday or day off, or the hours of a working day.
export function autoDay(date: string, emp: TimesheetEmployee, leaves: TimesheetLeave[], calendar: CalendarIndex, params: HrParams): { value: string; locked: boolean } {
  if (date < emp.hire_date || (emp.termination_date && date > emp.termination_date)) return { value: "—", locked: true };
  const leave = leaves.find((l) => l.hr_employee_id === emp.id && l.start_date <= date && date <= l.end_date);
  const holiday = calendar.get(date)?.kind === "holiday";
  // Annual leave does not count holidays, so a holiday inside it stays "B".
  if (leave && !(holiday && LEAVE_CODE[leave.kind] === "M")) return { value: LEAVE_CODE[leave.kind] || "M", locked: true };
  if (holiday) return { value: "B", locked: false };
  if (!isWorkingDay(date, calendar, emp.work_week || 5)) return { value: "İ", locked: false };
  return { value: String(dayHours(date, calendar, emp.work_week || 5, params)), locked: false };
}

export function timesheetRow(emp: TimesheetEmployee, period: string, leaves: TimesheetLeave[], marks: Record<string, string>, calendar: CalendarIndex, params: HrParams) {
  const cells: DayCell[] = periodDays(period).map((date) => {
    const auto = autoDay(date, emp, leaves, calendar, params);
    const mark = marks[date.slice(8)];
    const manual = !auto.locked && mark !== undefined && mark !== "" && mark !== auto.value;
    return { date, value: manual ? mark : auto.value, auto: auto.value, locked: auto.locked, manual };
  });
  const count = (code: string) => cells.filter((c) => c.value === code).length;
  // Ezamiyyət is working time: the day counts with its normal hours.
  const workedDays = cells.filter((c) => (isHours(c.value) && hoursOf(c.value) > 0) || c.value === "E").length;
  const workedHours = round2(cells.reduce((sum, c) => sum + (c.value === "E" ? hoursOf(autoDay(c.date, { ...emp, termination_date: null }, [], calendar, params).value) : hoursOf(c.value)), 0));
  const norm = workNorm(`${period}-01`, monthEnd(`${period}-01`), calendar, emp.work_week || 5, params.dailyHours);
  return {
    cells, workedDays, workedHours, norm,
    totals: { M: count("M"), Ö: count("Ö"), S: count("S"), T: count("T"), X: count("X"), E: count("E"), Q: count("Q"), B: count("B"), İ: count("İ") },
  };
}
export type TimesheetRow = ReturnType<typeof timesheetRow>;

// The overtime tabel: hours per day, stored as { "05": 2, ... }.
export function normalizeOvertime(raw: unknown): number | null {
  const value = String(raw ?? "").trim().replace(",", ".");
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? round2(n) : null;
}
export const overtimeHours = (overtime: Record<string, number>) => round2(Object.values(overtime).reduce((sum, h) => sum + (Number(h) || 0), 0));

// ---------------------------------------------------------------- payroll
// Versiya 3.60: the tax and insurance rates are a table of parameters by the date they apply from and the sector; every amount is
// worked out exactly (lib/decimal) and rounded to the qəpik only once per line. Sources (official texts, e-qanun.az):
// · gəlir vergisi — Vergi Məcəlləsi 101.1 (dövlət / neft-qaz: 14% 2500 ₼-dək, 350 ₼ + 25% artığından) və 101.1-1 (qeyri-neft,
//   qeyri-dövlət: 2026 — 3%, 75 ₼ + 10%, 625 ₼ + 14%; 2027 — 5% / 125 / 675; 2028-dən — 7% / 175 / 725); 200 ₼ güzəşt — 102.1.6
//   (yalnız əsas iş yerində, aylıq gəlir 2500 ₼-dək olduqda);
// · DSMF — "Sosial sığorta haqqında" Qanun 14.3 (22% + 3%) və 14.4 (297-VIIQD redaksiyası: 200 ₼-dək 3% / 22%; 200–8000 ₼ 6 ₼ + 10% / 44 ₼ + 15%;
//   8000 ₼-dan çox 786 ₼ + 10% / 1214 ₼ + 11%);
// · İTSH — "Tibbi sığorta haqqında" Qanun 15-10.1.2 (8000 ₼-dək 2%, artığından 0,5%) və 15-10.1.2-1 (qeyri-neft, qeyri-dövlət: 2500 ₼-dək 2%,
//   artığından 0,5%), hər tərəfdən;
// · İSH — 0,5% + 0,5% ("İşsizlikdən sığorta haqqında" Qanun; rəsmi mətni bu versiyada yoxlanmayıb — mühasib yoxlamalıdır).
// The redundancy / liquidation severance is free of income tax (Vergi Məcəlləsi 102.1.4) and of DSMF ("Sosial sığorta haqqında" 15).
export const OVERTIME_MULTIPLIER = 2; // Əmək Məcəlləsi: overtime is paid at least double.

export type JobKind = "main" | "additional";
export const JOB_KINDS: { key: JobKind; label: string }[] = [{ key: "main", label: "Əsas" }, { key: "additional", label: "Əlavə" }];
export const jobKindLabel = (value: unknown) => (value === "additional" ? "Əlavə" : "Əsas");

type Band = { upTo: number | null; rate: string }; // marginal: `rate` on the part of the base up to `upTo` above the previous band
export type RateSet = {
  from: string; sector: PayrollSector; label: string;
  incomeTax: Band[]; exemption: { amount: number; maxIncome: number };
  dsmf: Band[]; employerDsmf: Band[]; unemployment: Band[]; employerUnemployment: Band[]; medical: Band[]; employerMedical: Band[];
  sources: string[];
};
const flat = (rate: string): Band[] => [{ upTo: null, rate }];
const PRIVATE_INSURANCE = {
  dsmf: [{ upTo: 200, rate: "0.03" }, { upTo: null, rate: "0.10" }],
  employerDsmf: [{ upTo: 200, rate: "0.22" }, { upTo: 8000, rate: "0.15" }, { upTo: null, rate: "0.11" }],
  unemployment: flat("0.005"), employerUnemployment: flat("0.005"),
  medical: [{ upTo: 2500, rate: "0.02" }, { upTo: null, rate: "0.005" }], employerMedical: [{ upTo: 2500, rate: "0.02" }, { upTo: null, rate: "0.005" }],
};
const privateTax = (base: string): Band[] => [{ upTo: 2500, rate: base }, { upTo: 8000, rate: "0.10" }, { upTo: null, rate: "0.14" }];
const PRIVATE_SOURCES = ["Vergi Məcəlləsi 101.1-1, 102.1.6", "\"Sosial sığorta haqqında\" Qanun 14.4 (297-VIIQD)", "\"Tibbi sığorta haqqında\" Qanun 15-10.1.2-1", "İSH 0,5% (yoxlanmalıdır)"];
export const RATE_TABLE: RateSet[] = [
  { from: "2026-01-01", sector: "private_nonoil", label: "2026, qeyri-neft qeyri-dövlət", incomeTax: privateTax("0.03"), exemption: { amount: 200, maxIncome: 2500 }, ...PRIVATE_INSURANCE, sources: PRIVATE_SOURCES },
  { from: "2027-01-01", sector: "private_nonoil", label: "2027, qeyri-neft qeyri-dövlət", incomeTax: privateTax("0.05"), exemption: { amount: 200, maxIncome: 2500 }, ...PRIVATE_INSURANCE, sources: PRIVATE_SOURCES },
  { from: "2028-01-01", sector: "private_nonoil", label: "2028-dən, qeyri-neft qeyri-dövlət", incomeTax: privateTax("0.07"), exemption: { amount: 200, maxIncome: 2500 }, ...PRIVATE_INSURANCE, sources: PRIVATE_SOURCES },
  { from: "2026-01-01", sector: "state_oil", label: "Dövlət / neft-qaz sektoru", incomeTax: [{ upTo: 2500, rate: "0.14" }, { upTo: null, rate: "0.25" }], exemption: { amount: 200, maxIncome: 2500 },
    dsmf: flat("0.03"), employerDsmf: flat("0.22"), unemployment: flat("0.005"), employerUnemployment: flat("0.005"),
    medical: [{ upTo: 8000, rate: "0.02" }, { upTo: null, rate: "0.005" }], employerMedical: [{ upTo: 8000, rate: "0.02" }, { upTo: null, rate: "0.005" }],
    sources: ["Vergi Məcəlləsi 101.1, 102.1.6", "\"Sosial sığorta haqqında\" Qanun 14.3", "\"Tibbi sığorta haqqında\" Qanun 15-10.1.2", "İSH 0,5% (yoxlanmalıdır)"] },
];
// The set in force on the first day of `period` (YYYY-MM); a month before the first set takes the first one, with a warning.
export function ratesFor(period: string, sector: PayrollSector = "private_nonoil") {
  const day = `${String(period).slice(0, 7)}-01`;
  const sets = RATE_TABLE.filter((r) => r.sector === sector).sort((a, b) => a.from.localeCompare(b.from));
  const found = [...sets].reverse().find((r) => r.from <= day);
  return found ? { set: found, warning: "" } : { set: sets[0], warning: `${day.slice(0, 7)} üçün dərəcələr cədvəldə yoxdur — ${sets[0].label} dərəcələri götürüldü, mühasib yoxlamalıdır.` };
}
function bands(base: Dec, list: Band[]) {
  let total = Dec.zero, below = Dec.zero;
  for (const b of list) {
    if (!base.gt(below)) break;
    const top = b.upTo === null ? base : base.min(b.upTo);
    total = total.add(top.sub(below).mul(b.rate));
    if (b.upTo === null) break;
    below = Dec.of(b.upTo);
  }
  return total;
}
const periodOf = (period: string | number) => (typeof period === "number" ? `${period}-01` : period);

// The 200 ₼ exemption applies only at the main place of work and while the month's income is not over 2500 ₼ (102.1.6).
export function incomeTax(gross: number | Dec, period: string | number, jobKind: JobKind = "main", sector: PayrollSector = "private_nonoil") {
  const g = Dec.of(gross);
  if (!g.gt(0)) return 0;
  const { set } = ratesFor(periodOf(period), sector);
  const exempt = jobKind !== "additional" && !g.gt(set.exemption.maxIncome) ? Dec.of(set.exemption.amount) : Dec.zero;
  return bands(g.sub(exempt).max(0), set.incomeTax).toNumber();
}
// `dsmfBase` — the part of the gross DSMF is paid on (the gross without the severance free of it).
export function contributions(gross: number | Dec, period: string | number = "2026-01", sector: PayrollSector = "private_nonoil", dsmfBase?: number | Dec) {
  const g = Dec.of(gross).max(0), d = Dec.of(dsmfBase ?? gross).max(0);
  const { set } = ratesFor(periodOf(period), sector);
  return {
    dsmf: bands(d, set.dsmf).toNumber(),
    unemployment: bands(g, set.unemployment).toNumber(),
    medical: bands(g, set.medical).toNumber(),
    employerDsmf: bands(d, set.employerDsmf).toNumber(),
    employerUnemployment: bands(g, set.employerUnemployment).toNumber(),
    employerMedical: bands(g, set.employerMedical).toNumber(),
  };
}

// Versiya 3.56: "Digər əlavə" and "Digər tutulma" are no longer in the payroll (the firm's form has neither); old stored values are ignored.
// Versiya 3.60: the bonus is split — "bonus" is a bonus of the firm's pay system (counts towards the average for leave, NK 137, əlavə 1,
// bənd 2), "oneOff" a one-off bonus or material aid (does not count, bəndlər 1 və 4).
export type PayrollInputs = { bonus: number; oneOff: number; advance: number; alimony: number; note: string };
export const EMPTY_INPUTS: PayrollInputs = { bonus: 0, oneOff: 0, advance: 0, alimony: 0, note: "" };
export const PAYROLL_INPUT_KEYS = ["bonus", "oneOff", "advance", "alimony"] as const;
// The part of one leave that falls in the payroll's month (Versiya 3.60: with the whole leave's figures for the tooltip and the warnings).
export type LeavePay = {
  hr_employee_id: number; order_no: string | null; kind: string; days: number; daily: number; amount: number; averageMonths: number;
  start?: string; end?: string; total?: number; applied?: string; difference?: number; complete?: boolean; warnings?: string[];
};

// The final settlement of a worker dismissed in the month, from the signed termination order (its salary line is left out —
// the salary of the month comes from the tabel). `exempt` is the severance free of income tax and DSMF (liquidation, redundancy).
export type SettlementPay = { hr_employee_id: number; order_no: string | null; date: string; amount: number; exempt?: number; lines: { label: string; amount: number }[] };

export function payrollRow(input: { salary: number | null; period: string; row: TimesheetRow; overtime: number; leavePay: LeavePay[]; settlement?: SettlementPay[]; inputs: PayrollInputs; jobKind?: JobKind | string | null; sector?: PayrollSector }) {
  const salary = Number(input.salary) || 0;
  const { row } = input;
  const sector = input.sector || "private_nonoil";
  const hourly = row.norm.hours ? Dec.of(salary).div(Dec.of(row.norm.hours)) : Dec.zero;
  const salaryPart = hourly.mul(Dec.of(row.workedHours)).toNumber();
  const overtimePay = hourly.mul(Dec.of(input.overtime)).mul(OVERTIME_MULTIPLIER).toNumber();
  const leavePay = Dec.sum(input.leavePay.map((l) => l.amount)).toNumber();
  const settlementPay = Dec.sum((input.settlement || []).map((s) => s.amount)).toNumber();
  const exempt = Dec.sum((input.settlement || []).map((s) => s.exempt || 0));
  const bonus = Number(input.inputs.bonus) || 0, oneOff = Number(input.inputs.oneOff) || 0;
  const advance = Number(input.inputs.advance) || 0, alimony = Number(input.inputs.alimony) || 0;
  const gross = Dec.sum([salaryPart, overtimePay, bonus, oneOff, leavePay, settlementPay]);
  const taxable = gross.sub(exempt).max(0);
  const jobKind = input.jobKind === "additional" ? "additional" : "main";
  const tax = incomeTax(taxable, input.period, jobKind, sector);
  const c = contributions(gross, input.period, sector, taxable);
  const withheld = Dec.sum([tax, c.dsmf, c.unemployment, c.medical]);
  const payable = gross.sub(withheld);
  const otherDeductions = Dec.sum([advance, alimony]);
  // What goes to the card's Əmək haqqı when the month is approved: the payments that count towards the average for leave and those that do not.
  const settlementLines = (input.settlement || []).flatMap((s) => s.lines);
  const parts: EarningPart[] = [
    { key: "salary", label: "Faktiki işlənmiş vaxt üzrə əmək haqqı", amount: salaryPart, included: true },
    { key: "overtime", label: "İş vaxtından artıq iş", amount: overtimePay, included: true },
    { key: "bonus", label: "Mükafat (əməyin ödənilməsi sistemi üzrə)", amount: bonus, included: true },
    { key: "oneOff", label: "Birdəfəlik mükafat / maddi yardım", amount: oneOff, included: false },
    { key: "leave", label: "Məzuniyyət dövrü üçün saxlanılan orta əmək haqqı", amount: leavePay, included: true },
    ...settlementLines.map((l) => ({ key: "settlement", label: l.label, amount: l.amount, included: false })),
  ].filter((p) => p.amount);
  return {
    salary, salaryPart, hourly: hourly.toNumber(), overtimePay, leavePay, settlementPay, bonus, oneOff, gross: gross.toNumber(), exempt: exempt.toNumber(), tax, ...c,
    withheld: withheld.toNumber(), payable: payable.toNumber(), otherDeductions: otherDeductions.toNumber(),
    net: payable.sub(otherDeductions).toNumber(),
    employerCost: Dec.sum([gross, c.employerDsmf, c.employerUnemployment, c.employerMedical]).toNumber(),
    included: Dec.sum(parts.filter((p) => p.included).map((p) => p.amount)).toNumber(), parts,
    rateWarning: ratesFor(input.period, sector).warning,
  };
}
export type PayrollRow = ReturnType<typeof payrollRow>;
