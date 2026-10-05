// Period math for "sabit işlər" (fixed works), shared by the server and the page.
// Period keys are the ones stored in work_assignment_completions: "weekly:2026-01-05" (the week's Monday), "monthly:2026-01",
// and since Versiya 2.93 "quarterly:2026-Q1", "halfyearly:2026-H1", "yearly:2026".
// All days are counted in Baku time (UTC+4, no DST).
const BAKU_OFFSET_MS = 4 * 3600 * 1000;
const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
// Midnight (start of day) in Baku; month is 0-based and may overflow (e.g. 12 → January next year).
const bakuMidnight = (year: number, month: number, day: number) => Date.UTC(year, month, day) - BAKU_OFFSET_MS;

// Versiya 2.93: one "Sabit işlər" section with a tab per frequency.
export const FIXED_FREQUENCIES = ["weekly", "monthly", "quarterly", "halfyearly", "yearly"] as const;
export type FixedFrequency = (typeof FIXED_FREQUENCIES)[number];
export const FREQUENCY_TITLES: Record<FixedFrequency, string> = { weekly: "Həftəlik", monthly: "Aylıq", quarterly: "Rüblük", halfyearly: "Yarımillik", yearly: "İllik" };
// The frequencies whose deadline is "day D of month M after the period" (month 1 = the month right after it).
export const isLongPeriod = (frequency: string) => frequency === "quarterly" || frequency === "halfyearly" || frequency === "yearly";

export type FixedWorkRule = { frequency: string; due_day: number | null; due_month?: number | null };
export type PeriodState = "future" | "active" | "overdue" | "done" | "late-done" | "skipped";
// Versiya 2.89: which periods count at all — none before the counting start (admin setting, default 1 Oct 2026), and none that
// opened before the work was assigned to the person. A period that does not count is "skipped": no lateness, nothing to mark.
export type PeriodScope = { start?: string | null; assignedAt?: string | null };
export const DEFAULT_FIXED_START = "2026-10-01";

export const MONTH_NAMES = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
export const WEEKDAY_NAMES = ["Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə", "Şənbə", "Bazar"];
// "1-ci ay" … "12-ci ay" — the month after the period in which a long period's work is due.
export const MONTH_ORDINALS = ["1-ci", "2-ci", "3-cü", "4-cü", "5-ci", "6-cı", "7-ci", "8-ci", "9-cu", "10-cu", "11-ci", "12-ci"];

// Defaults: weekly — Friday of the following week; monthly — the 10th of the following month; quarterly and half-yearly — the
// 20th of the first month after the period; yearly — 31 March (the 31st of the 3rd month after the year).
export function dueDay(rule: FixedWorkRule) {
  return rule.due_day || (rule.frequency === "weekly" ? 5 : rule.frequency === "monthly" ? 10 : rule.frequency === "yearly" ? 31 : 20);
}
export function dueMonth(rule: FixedWorkRule) {
  return Math.min(Math.max(rule.due_month || (rule.frequency === "yearly" ? 3 : 1), 1), 12);
}

export function bakuToday(now = Date.now()) {
  const d = new Date(now + BAKU_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

export function monthlyKey(year: number, month: number) { return `monthly:${year}-${pad(month + 1)}`; }

// The Mondays that fall inside the given month — one column per week in the weekly table.
export function weeksOfMonth(year: number, month: number) {
  const weeks: { key: string; label: string }[] = [];
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (8 - (first.getUTCDay() || 7)) % 7;
  for (let day = 1 + offset; day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); day += 7) {
    const sunday = new Date(Date.UTC(year, month, day + 6));
    weeks.push({ key: `weekly:${year}-${pad(month + 1)}-${pad(day)}`, label: `${pad(day)}.${pad(month + 1)} – ${pad(sunday.getUTCDate())}.${pad(sunday.getUTCMonth() + 1)}` });
  }
  return weeks;
}

// The columns of a year's table for the frequency (weekly: the weeks of the given month; yearly: the given year alone).
export function periodsOf(frequency: string, year: number, month = 0): { key: string; label: string }[] {
  if (frequency === "weekly") return weeksOfMonth(year, month);
  if (frequency === "monthly") return MONTH_NAMES.map((label, i) => ({ key: monthlyKey(year, i), label }));
  if (frequency === "quarterly") return ["I", "II", "III", "IV"].map((roman, i) => ({ key: `quarterly:${year}-Q${i + 1}`, label: `${roman} rüb` }));
  if (frequency === "halfyearly") return ["I", "II"].map((roman, i) => ({ key: `halfyearly:${year}-H${i + 1}`, label: `${roman} yarımil` }));
  if (frequency === "yearly") return [{ key: `yearly:${year}`, label: String(year) }];
  return [];
}

// Every period of a year (weekly: all its weeks) — for counting late works.
export function periodsOfYear(frequency: string, year: number) {
  return frequency === "weekly" ? MONTH_NAMES.flatMap((_, m) => weeksOfMonth(year, m)) : periodsOf(frequency, year);
}

// A long period's own months: the first month (0-based) and how many months it covers.
function longPeriod(key: string): { year: number; first: number; months: number } | null {
  const quarter = key.match(/^quarterly:(\d{4})-Q([1-4])$/);
  if (quarter) return { year: Number(quarter[1]), first: (Number(quarter[2]) - 1) * 3, months: 3 };
  const half = key.match(/^halfyearly:(\d{4})-H([12])$/);
  if (half) return { year: Number(half[1]), first: (Number(half[2]) - 1) * 6, months: 6 };
  const year = key.match(/^yearly:(\d{4})$/);
  if (year) return { year: Number(year[1]), first: 0, months: 12 };
  return null;
}

// When a period can be worked on: a period opens once it has ended and is due in the following time — a monthly work on its
// day of the next month (January's work: 1 Feb → 10 Feb), a weekly one (since Versiya 2.91) on its weekday of the next week
// (the week of 5–11 Oct 2026: 12 Oct → Friday 16 Oct), a quarterly / half-yearly / yearly one (since 2.93) on day D of month M
// after the period (I quarter: 1 Apr → 20 Apr; the year 2026: 1 Jan 2027 → 31 Mar 2027). `due` is the end of the deadline day.
export function periodWindow(rule: FixedWorkRule, key: string): { start: number; due: number } | null {
  const monthly = key.match(/^monthly:(\d{4})-(\d{2})$/);
  if (monthly && rule.frequency === "monthly") {
    const year = Number(monthly[1]), dueMonthIndex = Number(monthly[2]);
    const daysInDueMonth = new Date(Date.UTC(year, dueMonthIndex + 1, 0)).getUTCDate();
    return { start: bakuMidnight(year, dueMonthIndex, 1), due: bakuMidnight(year, dueMonthIndex, Math.min(dueDay(rule), daysInDueMonth) + 1) };
  }
  const weekly = key.match(/^weekly:(\d{4})-(\d{2})-(\d{2})$/);
  if (weekly && rule.frequency === "weekly") {
    const year = Number(weekly[1]), month = Number(weekly[2]) - 1, day = Number(weekly[3]);
    return { start: bakuMidnight(year, month, day + 7), due: bakuMidnight(year, month, day + 7 + Math.min(Math.max(dueDay(rule), 1), 7)) };
  }
  const long = isLongPeriod(rule.frequency) ? longPeriod(key) : null;
  if (long && key.startsWith(`${rule.frequency}:`)) {
    const after = long.first + long.months;
    const dueIndex = after + dueMonth(rule) - 1;
    const daysInDueMonth = new Date(Date.UTC(long.year, dueIndex + 1, 0)).getUTCDate();
    return { start: bakuMidnight(long.year, after, 1), due: bakuMidnight(long.year, dueIndex, Math.min(dueDay(rule), daysInDueMonth) + 1) };
  }
  return null;
}

// Where the period itself begins: the week's Monday, the first of the month, or the first day of the quarter / half / year.
function periodBegin(rule: FixedWorkRule, key: string, window: { start: number }) {
  if (rule.frequency === "weekly") return window.start - 7 * DAY_MS;
  if (rule.frequency === "monthly") return bakuMidnight(Number(key.slice(8, 12)), Number(key.slice(13, 15)) - 1, 1);
  const long = longPeriod(key);
  return long ? bakuMidnight(long.year, long.first, 1) : window.start;
}

// A period counts when the period itself begins on or after the counting start, and the work was assigned before the period
// opened for work.
export function periodCounts(rule: FixedWorkRule, key: string, scope: PeriodScope = {}) {
  const window = periodWindow(rule, key);
  if (!window) return false;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(scope.start || "")) ? String(scope.start) : DEFAULT_FIXED_START;
  const [y, m, d] = start.split("-").map(Number);
  if (periodBegin(rule, key, window) < bakuMidnight(y, m - 1, d)) return false;
  const assigned = scope.assignedAt ? new Date(scope.assignedAt).getTime() : NaN;
  return Number.isNaN(assigned) || assigned < window.start;
}

export function periodState(rule: FixedWorkRule, key: string, completedAt: string | null | undefined, now = Date.now(), scope?: PeriodScope): PeriodState {
  const window = periodWindow(rule, key);
  const counts = !scope || periodCounts(rule, key, scope);
  // A mark left on a period that does not count shows as done, without lateness.
  if (completedAt) return !window || !counts || new Date(completedAt).getTime() < window.due ? "done" : "late-done";
  if (!counts) return "skipped";
  if (!window || now < window.start) return "future";
  return now < window.due ? "active" : "overdue";
}

export function overdueDays(rule: FixedWorkRule, key: string, now = Date.now()) {
  const window = periodWindow(rule, key);
  return window && now >= window.due ? Math.ceil((now - window.due + 1) / DAY_MS) : 0;
}

export function formatBakuDate(ms: number) {
  const d = new Date(ms + BAKU_OFFSET_MS);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function dueLabel(rule: FixedWorkRule) {
  if (rule.frequency === "weekly") return WEEKDAY_NAMES[Math.min(Math.max(dueDay(rule), 1), 7) - 1];
  if (isLongPeriod(rule.frequency)) return `${MONTH_ORDINALS[dueMonth(rule) - 1]} ayın ${dueDay(rule)}`;
  return String(dueDay(rule));
}
