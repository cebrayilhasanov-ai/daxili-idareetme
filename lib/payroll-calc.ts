import { addDays, isWorkingDay, monthEnd, round2, workNorm, type CalendarIndex, type HrParams } from "@/lib/hr-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54): the monthly time sheet (İş vaxtının uçot tabeli, form N-1t) and the payroll
// (Hesablama-ödəmə cədvəli) worked out from it. Shared by the API and the page, so both show the same figures.
// Each day of the tabel is filled from the production calendar and the worker's leaves (signed leave orders, sick notes);
// a department head writes only what differs (a shorter day, ezamiyyət, absence). Leave days cannot be overwritten — they
// follow the order. The payroll takes the card salary × worked days / norm days, overtime from the separate overtime tabel,
// leave pay from the leave orders (split by month: each month gets the pay of its own leave days and is taxed in that month),
// and the 2026–2028 private non-oil sector rates. The rates are a first version, to be checked against the accountant's rules.

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
// Private non-oil sector, from 2026 (vergi.az worked examples: 1500 → 1287.50 net, 9000 → 7221.50 net).
// Income tax: up to 2500 — the base rate on what exceeds 200; 2500–8000 — fixed + 10%; above 8000 — fixed + 14%.
const BASE_RATE: Record<number, number> = { 2026: 0.03, 2027: 0.05, 2028: 0.07 };
export const OVERTIME_MULTIPLIER = 2; // Əmək Məcəlləsi: overtime is paid at least double.

export function incomeTax(gross: number, year: number) {
  const rate = BASE_RATE[year] ?? BASE_RATE[year < 2026 ? 2026 : 2028];
  if (gross <= 0) return 0;
  if (gross <= 2500) return round2(Math.max(0, gross - 200) * rate);
  const fixed2 = 2500 * rate;
  if (gross <= 8000) return round2(fixed2 + (gross - 2500) * 0.1);
  return round2(fixed2 + 550 + (gross - 8000) * 0.14);
}
export function contributions(gross: number) {
  const g = Math.max(0, gross);
  return {
    dsmf: round2(Math.min(g, 200) * 0.03 + Math.max(0, g - 200) * 0.1),
    unemployment: round2(g * 0.005),
    medical: round2(Math.min(g, 2500) * 0.02 + Math.max(0, g - 2500) * 0.005),
    employerDsmf: round2(Math.min(g, 200) * 0.22 + Math.max(0, Math.min(g, 8000) - 200) * 0.15 + Math.max(0, g - 8000) * 0.11),
    employerUnemployment: round2(g * 0.005),
    employerMedical: round2(Math.min(g, 2500) * 0.02 + Math.max(0, g - 2500) * 0.005),
  };
}

export type PayrollInputs = { bonus: number; otherAdd: number; advance: number; alimony: number; otherDed: number; note: string };
export const EMPTY_INPUTS: PayrollInputs = { bonus: 0, otherAdd: 0, advance: 0, alimony: 0, otherDed: 0, note: "" };
export const PAYROLL_INPUT_KEYS = ["bonus", "otherAdd", "advance", "alimony", "otherDed"] as const;
export type LeavePay = { hr_employee_id: number; order_no: string | null; kind: string; days: number; daily: number; amount: number; averageMonths: number };

export function payrollRow(input: { salary: number | null; period: string; row: TimesheetRow; overtime: number; leavePay: LeavePay[]; inputs: PayrollInputs }) {
  const salary = Number(input.salary) || 0;
  const { row } = input;
  const salaryPart = row.norm.days ? round2((salary * row.workedDays) / row.norm.days) : 0;
  const hourly = row.norm.hours ? salary / row.norm.hours : 0;
  const overtimePay = round2(input.overtime * hourly * OVERTIME_MULTIPLIER);
  const leavePay = round2(input.leavePay.reduce((sum, l) => sum + l.amount, 0));
  const gross = round2(salaryPart + overtimePay + leavePay + input.inputs.bonus + input.inputs.otherAdd);
  const tax = incomeTax(gross, Number(input.period.slice(0, 4)));
  const c = contributions(gross);
  const withheld = round2(tax + c.dsmf + c.unemployment + c.medical);
  const otherDeductions = round2(input.inputs.advance + input.inputs.alimony + input.inputs.otherDed);
  return {
    salary, salaryPart, hourly: round2(hourly), overtimePay, leavePay, gross, tax, ...c, withheld, otherDeductions,
    net: round2(gross - withheld - otherDeductions),
    employerCost: round2(gross + c.employerDsmf + c.employerUnemployment + c.employerMedical),
  };
}
export type PayrollRow = ReturnType<typeof payrollRow>;
