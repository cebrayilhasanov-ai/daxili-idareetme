import { Dec } from "@/lib/decimal";

// HR calculations shared by the server and the HR page: work years, leave entitlement and balance, average earnings,
// working-day norms from the production calendar (istehsalat təqvimi) and the final settlement on termination.
// Every date is a plain "YYYY-MM-DD" string and all arithmetic runs in UTC, so time zones never shift a day.
// The legal figures (21 days, stage steps, 30.4, severance multipliers) live in HrParams so HR can change them without code.

export type LeaveKind = "annual" | "unpaid" | "sick" | "social" | "study" | "other";
export const LEAVE_KINDS: { key: LeaveKind; label: string }[] = [
  { key: "annual", label: "Əmək məzuniyyəti (illik)" },
  { key: "unpaid", label: "Ödənişsiz məzuniyyət" },
  { key: "sick", label: "Xəstəlik vərəqəsi" },
  { key: "social", label: "Sosial məzuniyyət" },
  { key: "study", label: "Təhsil məzuniyyəti" },
  { key: "other", label: "Digər" },
];
export const leaveKindLabel = (kind: string) => LEAVE_KINDS.find((k) => k.key === kind)?.label || kind;

export type CalendarKind = "holiday" | "dayoff" | "workday" | "short";
export const CALENDAR_KINDS: { key: CalendarKind; label: string }[] = [
  { key: "holiday", label: "Bayram günü" },
  { key: "dayoff", label: "Köçürülmüş istirahət günü" },
  { key: "workday", label: "İş günü (istirahət gününün əvəzinə)" },
  { key: "short", label: "Bayramqabağı qısaldılmış gün" },
];
export type CalendarDay = { date: string; kind: CalendarKind; name: string | null };

export const TERMINATION_REASONS: { key: string; label: string; severance: boolean }[] = [
  { key: "own", label: "İşçinin öz təşəbbüsü ilə", severance: false },
  { key: "agreement", label: "Tərəflərin razılığı ilə", severance: false },
  { key: "term", label: "Əmək müqaviləsinin müddəti bitdiyi üçün", severance: false },
  { key: "liquidation", label: "Müəssisənin ləğvi ilə əlaqədar", severance: true },
  { key: "reduction", label: "İşçilərin sayının və ya ştatların ixtisarı ilə əlaqədar", severance: true },
  { key: "employer", label: "İşəgötürənin təşəbbüsü ilə (digər əsaslar)", severance: false },
  { key: "other", label: "Digər əsas", severance: false },
];

export type HrParams = {
  baseLeaveDays: number;
  stageSteps: { years: number; days: number }[];
  avgMonths: number;
  avgDivisor: number;
  roundHalfMonth: boolean;
  unpaidExtendsWorkYear: boolean;
  excludeDayOffFromLeave: boolean;
  severanceSteps: { years: number; multiplier: number }[];
  dailyHours: number;
  // Versiya 3.60: replace the months of 140.1 (332-VIIQD) in the average for leave; the sector whose tax and insurance rates apply.
  replaceMonths: boolean;
  payrollSector: PayrollSector;
};
export type PayrollSector = "private_nonoil" | "state_oil";
export const PAYROLL_SECTORS: { key: PayrollSector; label: string }[] = [
  { key: "private_nonoil", label: "Neft-qaz sahəsində fəaliyyəti olmayan, qeyri-dövlət sektoru" },
  { key: "state_oil", label: "Dövlət sektoru və ya neft-qaz sahəsi" },
];

export const DEFAULT_HR_PARAMS: HrParams = {
  baseLeaveDays: 21,
  stageSteps: [{ years: 5, days: 2 }, { years: 10, days: 4 }, { years: 15, days: 6 }],
  avgMonths: 12,
  avgDivisor: 30.4,
  roundHalfMonth: true,
  unpaidExtendsWorkYear: true,
  excludeDayOffFromLeave: false,
  severanceSteps: [{ years: 0, multiplier: 1 }, { years: 1, multiplier: 1.4 }, { years: 5, multiplier: 1.7 }, { years: 10, multiplier: 2 }],
  dailyHours: 8,
  replaceMonths: true,
  payrollSector: "private_nonoil",
};

export function normalizeParams(raw: unknown): HrParams {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<HrParams>;
  const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback);
  const steps = <T extends object>(value: unknown, fallback: T[], valid: (item: T) => boolean) =>
    Array.isArray(value) && value.every((item) => item && typeof item === "object" && valid(item as T)) ? (value as T[]) : fallback;
  return {
    baseLeaveDays: num(input.baseLeaveDays, DEFAULT_HR_PARAMS.baseLeaveDays),
    stageSteps: steps(input.stageSteps, DEFAULT_HR_PARAMS.stageSteps, (s) => Number.isFinite(Number(s.years)) && Number.isFinite(Number(s.days)))
      .map((s) => ({ years: Number(s.years), days: Number(s.days) })).sort((a, b) => a.years - b.years),
    avgMonths: Math.max(1, Math.round(num(input.avgMonths, DEFAULT_HR_PARAMS.avgMonths))),
    avgDivisor: num(input.avgDivisor, DEFAULT_HR_PARAMS.avgDivisor) || DEFAULT_HR_PARAMS.avgDivisor,
    roundHalfMonth: typeof input.roundHalfMonth === "boolean" ? input.roundHalfMonth : DEFAULT_HR_PARAMS.roundHalfMonth,
    unpaidExtendsWorkYear: typeof input.unpaidExtendsWorkYear === "boolean" ? input.unpaidExtendsWorkYear : DEFAULT_HR_PARAMS.unpaidExtendsWorkYear,
    excludeDayOffFromLeave: typeof input.excludeDayOffFromLeave === "boolean" ? input.excludeDayOffFromLeave : DEFAULT_HR_PARAMS.excludeDayOffFromLeave,
    severanceSteps: steps(input.severanceSteps, DEFAULT_HR_PARAMS.severanceSteps, (s) => Number.isFinite(Number(s.years)) && Number.isFinite(Number(s.multiplier)))
      .map((s) => ({ years: Number(s.years), multiplier: Number(s.multiplier) })).sort((a, b) => a.years - b.years),
    dailyHours: num(input.dailyHours, DEFAULT_HR_PARAMS.dailyHours) || DEFAULT_HR_PARAMS.dailyHours,
    replaceMonths: typeof input.replaceMonths === "boolean" ? input.replaceMonths : DEFAULT_HR_PARAMS.replaceMonths,
    payrollSector: PAYROLL_SECTORS.some((x) => x.key === input.payrollSector) ? input.payrollSector as PayrollSector : DEFAULT_HR_PARAMS.payrollSector,
  };
}

// ---------- dates ----------
export const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromTime = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromTime(toTime(date) + days * 86400000);
export const diffDays = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / 86400000);
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12), month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromTime(Date.UTC(year, month, Math.min(d, lastDay)));
}
export const addYears = (date: string, years: number) => addMonths(date, years * 12);
export const weekday = (date: string) => { const day = new Date(toTime(date)).getUTCDay(); return day === 0 ? 7 : day; }; // 1 = Monday … 7 = Sunday
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const monthEnd = (date: string) => addDays(addMonths(monthStart(date), 1), -1);
export const todayIso = () => { const now = new Date(Date.now() + 4 * 3600000); return now.toISOString().slice(0, 10); }; // Baku, UTC+4
export const formatDay = (date: string | null | undefined) => { const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : "—"; };
export const round2 = (value: number) => Math.round(value * 100) / 100;

// Whole months from `from` to `to` (inclusive); a partial month of 15+ days counts as a full one when roundHalfMonth is on.
export function monthsBetween(from: string, to: string, roundHalfMonth: boolean) {
  if (to < from) return 0;
  let months = 0;
  while (addDays(addMonths(from, months + 1), -1) <= to) months += 1;
  const rest = diffDays(addMonths(from, months), to) + 1;
  if (roundHalfMonth && rest >= 15) months += 1;
  return months;
}

// Length of service as "X il Y ay Z gün" from `from` to `to` inclusive, plus prior months carried in from earlier jobs.
export function serviceParts(from: string, to: string, extraMonths = 0) {
  if (to < from) return { years: Math.floor(extraMonths / 12), months: extraMonths % 12, days: 0 };
  let months = 0;
  while (addMonths(from, months + 1) <= addDays(to, 1)) months += 1;
  const days = diffDays(addMonths(from, months), addDays(to, 1));
  const total = months + extraMonths;
  return { years: Math.floor(total / 12), months: total % 12, days };
}
// Choices for the family and education records (shared by the HR API and the card).
export const MARITAL_STATUSES = ["Subay", "Evli", "Boşanmış", "Dul"];
export const FAMILY_RELATIONS = ["Həyat yoldaşı", "Oğlu", "Qızı", "Atası", "Anası", "Qardaşı", "Bacısı"];
export const EDUCATION_LEVELS = ["Ümumi orta", "Tam orta", "Peşə", "Orta ixtisas", "Bakalavr", "Magistr", "Doktorantura", "Kurs / sertifikat"];

// Length of service at earlier employers. Periods that overlap (two jobs at once) or run back to back are merged first, so no
// day is counted twice; each merged period is measured in calendar months plus days, and the leftover days are carried at 30 days = 1 month.
export type PriorJobPeriod = { start_date: string; end_date: string };
export function priorService(jobs: PriorJobPeriod[]) {
  const periods = jobs.filter((j) => isIsoDate(j.start_date) && isIsoDate(j.end_date) && j.end_date >= j.start_date)
    .map((j) => ({ start: j.start_date, end: j.end_date })).sort((a, b) => a.start.localeCompare(b.start));
  const merged: { start: string; end: string }[] = [];
  for (const p of periods) {
    const last = merged[merged.length - 1];
    if (last && p.start <= addDays(last.end, 1)) { if (p.end > last.end) last.end = p.end; }
    else merged.push({ ...p });
  }
  let months = 0, days = 0;
  for (const p of merged) { const parts = serviceParts(p.start, p.end); months += parts.years * 12 + parts.months; days += parts.days; }
  months += Math.floor(days / 30);
  days %= 30;
  return { years: Math.floor(months / 12), months: months % 12, days, totalMonths: months };
}
export const serviceText = (parts: { years: number; months: number; days: number }) =>
  [parts.years ? `${parts.years} il` : "", parts.months ? `${parts.months} ay` : "", parts.days ? `${parts.days} gün` : ""].filter(Boolean).join(" ") || "0 gün";

// ---------- production calendar ----------
export type CalendarIndex = Map<string, CalendarDay>;
export const indexCalendar = (days: CalendarDay[]): CalendarIndex => new Map(days.map((d) => [d.date, d]));

export function isWorkingDay(date: string, calendar: CalendarIndex, workWeek: number) {
  const special = calendar.get(date)?.kind;
  if (special === "workday") return true;
  if (special === "holiday" || special === "dayoff") return false;
  return weekday(date) <= (workWeek === 6 ? 6 : 5);
}

export function workNorm(from: string, to: string, calendar: CalendarIndex, workWeek: number, dailyHours: number) {
  let days = 0, hours = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d, calendar, workWeek)) continue;
    days += 1;
    // A 6-day week spreads the same 40 hours over six days, so each day is shorter.
    const dayHours = workWeek === 6 ? (dailyHours * 5) / 6 : dailyHours;
    hours += dayHours - (calendar.get(d)?.kind === "short" ? 1 : 0);
  }
  return { days, hours: round2(hours) };
}

// Annual leave is counted in calendar days; holidays inside it are not counted (and transferred days off, if the parameter says so).
export function leaveDaysBetween(start: string, end: string, calendar: CalendarIndex, params: HrParams) {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return 0;
  let days = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const kind = calendar.get(d)?.kind;
    if (kind === "holiday" || (kind === "dayoff" && params.excludeDayOffFromLeave)) continue;
    days += 1;
  }
  return days;
}

// Azerbaijan's fixed public holidays plus the religious holidays known for the given year. It is only a starting point:
// the Cabinet of Ministers announces transferred days each year, and HR checks and edits the list.
export function suggestedHolidays(year: number): CalendarDay[] {
  const fixed: [string, string][] = [
    ["01-01", "Yeni il bayramı"], ["01-02", "Yeni il bayramı"], ["01-20", "Ümumxalq Hüzn Günü"], ["03-08", "Qadınlar günü"],
    ["03-20", "Novruz bayramı"], ["03-21", "Novruz bayramı"], ["03-22", "Novruz bayramı"], ["03-23", "Novruz bayramı"], ["03-24", "Novruz bayramı"],
    ["05-09", "Faşizm üzərində qələbə günü"], ["05-28", "Müstəqillik Günü"], ["06-15", "Azərbaycan xalqının Milli Qurtuluş Günü"],
    ["06-26", "Azərbaycan Respublikasının Silahlı Qüvvələri Günü"], ["11-08", "Zəfər Günü"], ["11-09", "Dövlət Bayrağı Günü"],
    ["12-31", "Dünya azərbaycanlılarının həmrəyliyi günü"],
  ];
  const religious: Record<number, [string, string][]> = {
    2026: [["03-20", "Ramazan bayramı"], ["03-21", "Ramazan bayramı"], ["05-27", "Qurban bayramı"], ["05-28", "Qurban bayramı"]],
  };
  const names = new Map<string, string[]>();
  for (const [md, name] of [...fixed, ...(religious[year] || [])]) {
    const date = `${year}-${md}`;
    names.set(date, [...(names.get(date) || []), name]);
  }
  return [...names.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, kind: "holiday", name: [...new Set(list)].join(" / ") }));
}

// ---------- leave entitlement and balance ----------
export type HrEmployeeCalc = {
  hire_date: string;
  termination_date: string | null;
  prior_experience_months: number;
  base_leave_days: number | null;
  extra_leave_days: number;
  opening_balance_date: string | null;
  opening_balance_days: number | null;
  work_week: number;
  monthly_salary: number | null;
};
export type HrLeaveCalc = { id: number; kind: string; start_date: string; end_date: string; days: number; order_no?: string | null };
export type WorkYear = { start: string; end: string; stageYears: number; entitlement: number };

function overlap(from: string, to: string, leaves: HrLeaveCalc[], kind: string) {
  let days = 0;
  for (const leave of leaves) {
    if (leave.kind !== kind) continue;
    const a = leave.start_date > from ? leave.start_date : from;
    const b = leave.end_date < to ? leave.end_date : to;
    if (b >= a) days += diffDays(a, b) + 1;
  }
  return days;
}

export function stageExtraDays(stageYears: number, params: HrParams) {
  let days = 0;
  for (const step of params.stageSteps) if (stageYears >= step.years) days = step.days;
  return days;
}

// Work years run from the hire date, not the calendar year; unpaid leave pushes the end of the year it falls in.
export function workYears(emp: HrEmployeeCalc, leaves: HrLeaveCalc[], params: HrParams, until: string): WorkYear[] {
  const years: WorkYear[] = [];
  if (!isIsoDate(emp.hire_date)) return years;
  let start = emp.hire_date;
  for (let guard = 0; start <= until && guard < 80; guard++) {
    const nominalEnd = addDays(addYears(start, 1), -1);
    let end = nominalEnd;
    if (params.unpaidExtendsWorkYear) {
      for (let i = 0; i < 10; i++) {
        const next = addDays(nominalEnd, overlap(start, end, leaves, "unpaid"));
        if (next === end) break;
        end = next;
      }
    }
    const stageYears = Math.floor((emp.prior_experience_months + monthsBetween(emp.hire_date, addDays(start, -1), false)) / 12);
    const entitlement = (emp.base_leave_days ?? params.baseLeaveDays) + stageExtraDays(stageYears, params) + (emp.extra_leave_days || 0);
    years.push({ start, end, stageYears, entitlement });
    start = addDays(end, 1);
  }
  return years;
}

// Days earned inside one work year up to `date`: the full entitlement once the year is over, otherwise pro rata by months.
function earnedInYear(year: WorkYear, date: string, params: HrParams) {
  if (date < year.start) return 0;
  if (date >= year.end) return year.entitlement;
  return (year.entitlement * Math.min(12, monthsBetween(year.start, date, params.roundHalfMonth))) / 12;
}

export type LedgerRow = { date: string; label: string; plus: number; minus: number; balance: number; leaveId?: number };
export type LeaveBalance = { asOf: string; balance: number; earned: number; used: number; ledger: LedgerRow[]; years: WorkYear[]; current: WorkYear | null };

export function leaveBalance(emp: HrEmployeeCalc, leaves: HrLeaveCalc[], params: HrParams, asOfInput: string): LeaveBalance {
  const asOf = emp.termination_date && emp.termination_date < asOfInput ? emp.termination_date : asOfInput;
  const years = workYears(emp, leaves, params, asOf);
  const opening = emp.opening_balance_date && isIsoDate(emp.opening_balance_date) && emp.opening_balance_date <= asOf ? emp.opening_balance_date : null;
  const events: Omit<LedgerRow, "balance">[] = [];
  if (opening) events.push({ date: opening, label: "Başlanğıc qalıq (sistemə köçürülərkən)", plus: Number(emp.opening_balance_days || 0), minus: 0 });
  for (const year of years) {
    if (opening && year.end <= opening) continue;
    const upTo = year.end < asOf ? year.end : asOf;
    const earned = earnedInYear(year, upTo, params) - (opening && opening >= year.start ? earnedInYear(year, opening, params) : 0);
    if (earned <= 0) continue;
    const complete = upTo >= year.end;
    const months = monthsBetween(year.start, upTo, params.roundHalfMonth);
    const label = `İş ili ${formatDay(year.start)} – ${formatDay(year.end)}: ${year.entitlement} gün${complete ? "" : ` × ${Math.min(12, months)}/12 ay (natamam)`}${opening && opening >= year.start ? ", başlanğıc qalıqdan sonrakı hissə" : ""}`;
    events.push({ date: upTo, label, plus: round2(earned), minus: 0 });
  }
  for (const leave of leaves) {
    if (leave.kind !== "annual" || leave.start_date > asOf || (opening && leave.start_date <= opening)) continue;
    events.push({ date: leave.start_date, label: `Məzuniyyət ${formatDay(leave.start_date)} – ${formatDay(leave.end_date)}${leave.order_no ? `, əmr № ${leave.order_no}` : ""}`, plus: 0, minus: Number(leave.days || 0), leaveId: leave.id });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.plus - a.plus);
  let balance = 0, earned = 0, used = 0;
  const ledger = events.map((e) => { balance = round2(balance + e.plus - e.minus); earned += e.plus; used += e.minus; return { ...e, balance }; });
  const current = years.find((y) => y.start <= asOf && asOf <= y.end) || null;
  return { asOf, balance, earned: round2(earned), used: round2(used), ledger, years, current };
}

// ---------- earnings ----------
// One month of the card's "Əmək haqqı": `amount` is what counts towards the average for leave (Əmək Məcəlləsi 139, Nazirlər
// Kabinetinin 25.08.1999 tarixli 137 nömrəli qərarı); since Versiya 3.60 an approved payroll also keeps the month's make-up in
// `parts` (what was left out, e.g. a one-off bonus or leave compensation) and the month may carry the reason it is replaced.
export type EarningPart = { key: string; label: string; amount: number; included: boolean };
export type SalaryRow = { period: string; amount: number; parts?: string | EarningPart[] | null; replace_reason?: string | null };

// Əmək Məcəlləsi 140.1, ikinci cümlə (30.12.2025 tarixli 332-VIIQD nömrəli Qanun, 16.01.2026-dan qüvvədədir): months not worked or
// not fully worked for these reasons are replaced by the nearest fully worked calendar months. The same law added to 111.1 that
// the average kept for leave is "not less than the last salary".
export const LAW_332_IN_FORCE = "2026-01-16";
export const REPLACE_REASONS: { key: string; label: string }[] = [
  { key: "social_partial", label: "Qismən ödənişli sosial məzuniyyət" },
  { key: "unpaid_employer", label: "İşçinin təşəbbüsü ilə olmayan ödənişsiz məzuniyyət" },
  { key: "downtime", label: "İşçinin təqsiri olmadan boşdayanma" },
];
export const replaceReasonLabel = (key: string | null | undefined) => REPLACE_REASONS.find((r) => r.key === key)?.label || "";
export function earningParts(raw: SalaryRow["parts"]): EarningPart[] {
  if (!raw) return [];
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.filter((p) => p && typeof p === "object").map((p) => ({ key: String(p.key || ""), label: String(p.label || ""), amount: Number(p.amount) || 0, included: Boolean(p.included) })) : [];
  } catch { return []; }
}

export type BaseMonthStatus = "counted" | "replacement" | "replaced" | "dropped" | "partial" | "missing";
export type BaseMonth = { period: string; status: BaseMonthStatus; amount: number | null; excluded: number; note: string; replaces?: string; replacedBy?: string };
export type AverageResult = {
  // Kept for the earlier callers: the months that make up the average, their count and the rounded figures.
  rows: { period: string; amount: number | null }[]; months: number; total: number; monthly: number; daily: number;
  exact: { total: Dec; monthly: Dec | null; daily: Dec | null };
  basePeriod: { from: string; to: string };
  base: BaseMonth[];
  fewerThanFull: boolean;
  missing: string[];
  complete: boolean;
  warnings: string[];
  legal: string[];
};

const MONTH_LABELS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
export const monthLabel = (period: string) => `${MONTH_LABELS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

// Average earnings for leave (and for unused-leave compensation, 140.4) at `date`:
// · the 12 calendar months before the month of `date` (140.1), whatever work year the leave is for;
// · a worker employed less than 12 calendar months by then — only the full calendar months of employment (140.2): a month counts
//   when the worker was employed from its first day to its last;
// · from 16.01.2026 a month marked with a reason of 140.1 is replaced by the nearest earlier fully worked month (one with
//   earnings on record and no such reason); a month that has no such month to take its place is left out of the average;
// · monthly = total / number of months, daily = monthly / 30,4 (140.3), both exact — nothing is rounded here.
// A month of the period with no earnings on record is not taken as 0: it is listed in `missing` and the result is incomplete.
export function legalAverage(emp: { hire_date: string; termination_date?: string | null }, salaries: SalaryRow[], date: string, params: HrParams, leaves: HrLeaveCalc[] = []): AverageResult {
  const start = monthStart(date);
  const periods: string[] = [];
  for (let i = params.avgMonths; i >= 1; i--) periods.push(addMonths(start, -i).slice(0, 7));
  const byPeriod = new Map(salaries.map((s) => [s.period, s]));
  const employedWhole = (p: string) => `${p}-01` >= emp.hire_date && (!emp.termination_date || monthEnd(`${p}-01`) <= emp.termination_date);
  const fewerThanFull = emp.hire_date > `${periods[0]}-01`;
  const replaceOn = params.replaceMonths && date >= LAW_332_IN_FORCE;
  const warnings: string[] = [];
  const legal = ["Əmək Məcəlləsi, 139-cu maddə və Nazirlər Kabinetinin 25.08.1999 tarixli 137 nömrəli qərarı (nəzərə alınan və alınmayan ödənişlər)", "Əmək Məcəlləsi, 140-cı maddənin 1-ci və 3-cü hissələri (12 təqvim ayı, ÷ 12, ÷ 30,4)"];
  if (fewerThanFull) legal.push("Əmək Məcəlləsi, 140-cı maddənin 2-ci hissəsi (12 təqvim ayından az əmək münasibəti — faktiki işlənmiş tam təqvim ayları)");
  const amountOf = (p: string) => { const s = byPeriod.get(p); return s ? Number(s.amount) : null; };
  const excludedOf = (p: string) => round2(earningParts(byPeriod.get(p)?.parts).filter((x) => !x.included).reduce((sum, x) => sum + x.amount, 0));
  const reasonOf = (p: string) => { const r = byPeriod.get(p)?.replace_reason; return r && REPLACE_REASONS.some((x) => x.key === r) ? r : null; };

  const base: BaseMonth[] = [];
  const used: string[] = [];
  const toReplace: string[] = [];
  for (const p of periods) {
    if (!employedWhole(p)) {
      // Months before the hire month are simply outside the employment and are not listed; the hire month itself is a partial one.
      if (monthEnd(`${p}-01`) >= emp.hire_date) base.push({ period: p, status: "partial", amount: amountOf(p), excluded: excludedOf(p), note: "Tam təqvim ayı deyil (işə qəbul ayın 1-dən deyil) — nəzərə alınmır (140.2)" });
      continue;
    }
    if (replaceOn && reasonOf(p)) { toReplace.push(p); continue; }
    used.push(p);
  }
  // The nearest earlier fully worked months take the place of the replaced ones, one each, newest first.
  const candidates: string[] = [];
  if (toReplace.length) {
    for (let i = 1; i <= 36 && candidates.length < toReplace.length; i++) {
      const p = addMonths(`${periods[0]}-01`, -i).slice(0, 7);
      if (!employedWhole(p)) break;
      if (amountOf(p) !== null && !reasonOf(p)) candidates.push(p);
    }
    legal.push("Əmək Məcəlləsi, 140-cı maddənin 1-ci hissəsinin ikinci cümləsi (30.12.2025 tarixli 332-VIIQD nömrəli Qanun) — ayların əvəzlənməsi");
  }
  toReplace.forEach((p, i) => {
    const by = candidates[i];
    const reason = replaceReasonLabel(reasonOf(p));
    if (by) {
      base.push({ period: p, status: "replaced", amount: amountOf(p), excluded: excludedOf(p), note: `${reason} — ${monthLabel(by)} ayı ilə əvəz olunub`, replacedBy: by });
      base.push({ period: by, status: "replacement", amount: amountOf(by), excluded: excludedOf(by), note: `${monthLabel(p)} ayının əvəzinə (yaxın tam işlənmiş ay)`, replaces: p });
      used.push(by);
    } else {
      base.push({ period: p, status: "dropped", amount: amountOf(p), excluded: excludedOf(p), note: `${reason} — əvəz edəcək tam işlənmiş ay tapılmadı, ay ortadan çıxarılıb` });
      warnings.push(`${monthLabel(p)}: ${reason.toLocaleLowerCase("az")} səbəbindən əvəzlənməli idi, lakin əvvəlki aylarda tam işlənmiş və əmək haqqı qeyd olunmuş ay yoxdur — ay hesablamaya daxil edilmədi.`);
    }
  });
  const missing: string[] = [];
  for (const p of used) {
    const amount = amountOf(p);
    if (amount === null) { missing.push(p); if (!base.some((b) => b.period === p)) base.push({ period: p, status: "missing", amount: null, excluded: 0, note: "Əmək haqqı qeyd olunmayıb — 0 qəbul edilmir, məlumatı daxil edin" }); else { const b = base.find((x) => x.period === p); if (b) b.status = "missing"; } }
    else if (!base.some((b) => b.period === p)) base.push({ period: p, status: "counted", amount, excluded: excludedOf(p), note: "" });
  }
  base.sort((a, b) => a.period.localeCompare(b.period));
  if (missing.length) warnings.push(`Hesablaşma dövrünün ${missing.map(monthLabel).join(", ")} ay(lar)ı üçün əmək haqqı qeyd olunmayıb. Bu aylar 0 hesab edilmir; nəticə natamamdır — “Personallar → Əmək haqqı” tabında məbləğləri daxil edin.`);
  // Months the worker spent (partly) on unpaid or social leave that are not marked: the reason decides whether they are replaced.
  if (params.replaceMonths && date >= LAW_332_IN_FORCE) {
    for (const p of used) {
      if (reasonOf(p)) continue;
      const from = `${p}-01`, to = monthEnd(from);
      const hit = leaves.find((l) => (l.kind === "unpaid" || l.kind === "social") && l.start_date <= to && l.end_date >= from);
      if (hit) warnings.push(`${monthLabel(p)}: bu ayda ${hit.kind === "unpaid" ? "ödənişsiz" : "sosial"} məzuniyyət var (${formatDay(hit.start_date)} – ${formatDay(hit.end_date)}). ${hit.kind === "unpaid" ? "İşçinin təşəbbüsü ilə deyilsə" : "Qismən ödənişlidirsə"}, “Əmək haqqı” tabında bu ay üçün əvəzlənmə səbəbini seçin (140.1).`);
    }
  }
  const counted = used.filter((p) => amountOf(p) !== null);
  const total = Dec.sum(counted.map((p) => Dec.of(amountOf(p) as number)));
  const monthly = counted.length ? total.div(counted.length) : null;
  const daily = monthly ? monthly.div(Dec.of(params.avgDivisor)) : null;
  if (!counted.length) warnings.push(fewerThanFull ? "İşçinin hesablaşma dövründə tam təqvim ayı yoxdur — orta əmək haqqı hesablana bilmir." : "Hesablaşma dövründə əmək haqqı qeyd olunmuş ay yoxdur — orta əmək haqqı hesablana bilmir.");
  return {
    rows: counted.map((p) => ({ period: p, amount: amountOf(p) })), months: counted.length, total: total.toNumber(), monthly: monthly ? monthly.toNumber() : 0, daily: daily ? daily.toNumber() : 0,
    exact: { total, monthly, daily }, basePeriod: { from: periods[0], to: periods[periods.length - 1] }, base, fewerThanFull, missing, complete: !missing.length && counted.length > 0, warnings, legal,
  };
}

export function severanceMultiplier(serviceYears: number, params: HrParams) {
  let multiplier = 0;
  for (const step of params.severanceSteps) if (serviceYears >= step.years) multiplier = step.multiplier;
  return multiplier;
}

export type SettlementInput = { date: string; reasonKey: string; severance: boolean; workedDays?: number | null; deductOverused: boolean };
export type Settlement = {
  date: string;
  norm: { days: number; hours: number };
  workedDays: number;
  salaryPart: number;
  balance: LeaveBalance;
  average: AverageResult;
  compensationDays: number;
  compensation: number;
  overusedDays: number;
  overusedDeduction: number;
  serviceYears: number;
  severanceMultiplier: number;
  severance: number;
  total: number;
};

export function settlement(emp: HrEmployeeCalc, leaves: HrLeaveCalc[], salaries: SalaryRow[], calendar: CalendarIndex, params: HrParams, input: SettlementInput): Settlement {
  const date = input.date;
  const from = emp.hire_date > monthStart(date) ? emp.hire_date : monthStart(date);
  const norm = workNorm(monthStart(date), monthEnd(date), calendar, emp.work_week, params.dailyHours);
  const autoWorked = workNorm(from, date, calendar, emp.work_week, params.dailyHours).days;
  const workedDays = input.workedDays ?? autoWorked;
  const salaryPart = norm.days ? round2(((emp.monthly_salary || 0) * workedDays) / norm.days) : 0;
  const balance = leaveBalance({ ...emp, termination_date: null }, leaves, params, date);
  // Versiya 3.60: unused leave is compensated by the leave-pay method of 140 (140.4) — the 12 months before the month of dismissal.
  const average = legalAverage(emp, salaries, date, params, leaves);
  const daily = average.exact.daily || Dec.zero;
  const compensationDays = Math.max(0, balance.balance);
  const compensation = daily.mul(Dec.of(round2(compensationDays))).toNumber();
  const overusedDays = Math.max(0, -balance.balance);
  const overusedDeduction = input.deductOverused ? daily.mul(Dec.of(round2(overusedDays))).toNumber() : 0;
  const serviceYears = Math.floor(monthsBetween(emp.hire_date, date, false) / 12);
  const multiplier = input.severance ? severanceMultiplier(serviceYears, params) : 0;
  const severance = (average.exact.monthly || Dec.zero).mul(Dec.of(multiplier)).toNumber();
  const total = Dec.sum([salaryPart, compensation, severance]).sub(overusedDeduction).toNumber();
  return { date, norm, workedDays, salaryPart, balance, average, compensationDays, compensation, overusedDays, overusedDeduction, serviceYears, severanceMultiplier: multiplier, severance, total };
}
