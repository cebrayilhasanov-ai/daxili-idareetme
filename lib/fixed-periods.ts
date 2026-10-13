// Period math for "sabit işlər" (fixed works), shared by the server and the page.
// Period keys are the ones stored in work_assignment_completions: "weekly:2026-01-05" (the week's Monday), "monthly:2026-01",
// and since Versiya 2.93 "quarterly:2026-Q1", "halfyearly:2026-H1", "yearly:2026"; since 3.22 "daily:2026-10-13" (a working day).
// All days are counted in Baku time (UTC+4, no DST).
const BAKU_OFFSET_MS = 4 * 3600 * 1000;
const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
// Midnight (start of day) in Baku; month is 0-based and may overflow (e.g. 12 → January next year).
const bakuMidnight = (year: number, month: number, day: number) => Date.UTC(year, month, day) - BAKU_OFFSET_MS;

// Versiya 2.93: one "Sabit işlər" section with a tab per frequency.
export const FIXED_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "halfyearly", "yearly"] as const;
export type FixedFrequency = (typeof FIXED_FREQUENCIES)[number];
export const FREQUENCY_TITLES: Record<FixedFrequency, string> = { daily: "Günlük", weekly: "Həftəlik", monthly: "Aylıq", quarterly: "Rüblük", halfyearly: "Yarımillik", yearly: "İllik" };
// The frequencies whose deadline is "day D of month M after the period" (month 1 = the month right after it).
export const isLongPeriod = (frequency: string) => frequency === "quarterly" || frequency === "halfyearly" || frequency === "yearly";

// A daily work (Versiya 3.22): due_day 0 / null — due the same day, 1 — on the next working day; due_time "HH:MM" (default 18:00).
export type FixedWorkRule = { frequency: string; due_day: number | null; due_month?: number | null; due_time?: string | null };
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
// Versiya 2.94: a quarterly work is always due on the 20th of the next quarter's first month — the admin no longer picks it.
export const hasFixedDue = (frequency: string) => frequency === "quarterly";
export function dueDay(rule: FixedWorkRule) {
  if (hasFixedDue(rule.frequency)) return 20;
  if (rule.frequency === "daily") return rule.due_day === 1 ? 1 : 0;
  return rule.due_day || (rule.frequency === "weekly" ? 5 : rule.frequency === "monthly" ? 10 : rule.frequency === "yearly" ? 31 : 20);
}
export function dueMonth(rule: FixedWorkRule) {
  if (hasFixedDue(rule.frequency)) return 1;
  return Math.min(Math.max(rule.due_month || (rule.frequency === "yearly" ? 3 : 1), 1), 12);
}

export function bakuToday(now = Date.now()) {
  const d = new Date(now + BAKU_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

// Versiya 3.22: daily works fall on working days only — Monday to Friday, with the HR production calendar (istehsalat təqvimi):
// a holiday or a moved day off is not a working day, a "workday" in place of a day off is. The calendar is handed in once by
// whoever holds it (the page after loading, the server before checking a mark); without it only weekends are left out.
let workCalendar = new Map<string, string>();
let calendarSource: unknown = null;
export function setFixedCalendar(days: { date: string; kind: string }[] | null | undefined) {
  if (!days || days === calendarSource) return;
  calendarSource = days;
  workCalendar = new Map(days.map((d) => [d.date, d.kind]));
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shiftDay = (date: string, by: number) => isoDay(Date.parse(`${date}T00:00:00Z`) + by * DAY_MS);
export function isFixedWorkday(date: string) {
  const kind = workCalendar.get(date);
  if (kind === "workday") return true;
  if (kind === "holiday" || kind === "dayoff") return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}
function nextWorkday(date: string) {
  let next = shiftDay(date, 1);
  for (let i = 0; i < 40 && !isFixedWorkday(next); i++) next = shiftDay(next, 1);
  return next;
}
export function dueTime(rule: FixedWorkRule) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.due_time || "")) ? String(rule.due_time) : "18:00";
}
// The working days of a month — one column per day in the daily table.
export function workdaysOfMonth(year: number, month: number) {
  const days: { key: string; label: string }[] = [];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    if (isFixedWorkday(date)) days.push({ key: `daily:${date}`, label: `${pad(day)}.${pad(month + 1)}` });
  }
  return days;
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
  if (frequency === "daily") return workdaysOfMonth(year, month);
  if (frequency === "weekly") return weeksOfMonth(year, month);
  if (frequency === "monthly") return MONTH_NAMES.map((label, i) => ({ key: monthlyKey(year, i), label }));
  if (frequency === "quarterly") return ["I", "II", "III", "IV"].map((roman, i) => ({ key: `quarterly:${year}-Q${i + 1}`, label: `${roman} rüb` }));
  if (frequency === "halfyearly") return ["I", "II"].map((roman, i) => ({ key: `halfyearly:${year}-H${i + 1}`, label: `${roman} yarımil` }));
  if (frequency === "yearly") return [{ key: `yearly:${year}`, label: String(year) }];
  return [];
}

// Every period of a year (weekly: all its weeks) — for counting late works.
export function periodsOfYear(frequency: string, year: number) {
  return frequency === "weekly" || frequency === "daily" ? MONTH_NAMES.flatMap((_, m) => periodsOf(frequency, year, m)) : periodsOf(frequency, year);
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
// A daily work (since 3.22) opens at the start of its working day and is due at its hour that day or on the next working day.
export function periodWindow(rule: FixedWorkRule, key: string): { start: number; due: number } | null {
  const daily = key.match(/^daily:(\d{4})-(\d{2})-(\d{2})$/);
  if (daily && rule.frequency === "daily") {
    const date = key.slice(6);
    if (!isFixedWorkday(date)) return null;
    const dueDate = dueDay(rule) === 1 ? nextWorkday(date) : date;
    const [hour, minute] = dueTime(rule).split(":").map(Number);
    const [y, m, d] = dueDate.split("-").map(Number);
    return { start: bakuMidnight(Number(daily[1]), Number(daily[2]) - 1, Number(daily[3])), due: bakuMidnight(y, m - 1, d) + (hour * 60 + minute) * 60000 };
  }
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

// Where the period counts from: the week's Monday or the first of the month; a quarter / half / year (since Versiya 2.94) from
// the day it opens for work, so the III quarter of 2026 (opens 1 Oct, due 20 Oct) counts from a 1 Oct start.
function periodBegin(rule: FixedWorkRule, key: string, window: { start: number }) {
  if (rule.frequency === "weekly") return window.start - 7 * DAY_MS;
  if (rule.frequency === "monthly") return bakuMidnight(Number(key.slice(8, 12)), Number(key.slice(13, 15)) - 1, 1);
  return window.start;
}

// A period counts when it begins (see periodBegin) on or after the counting start, and the work was assigned before the period
// opened for work — a quarterly one (since Versiya 3.10) before its deadline, so a work assigned on 9 Oct 2026 counts the III
// quarter (opens 1 Oct, due 20 Oct).
export function periodCounts(rule: FixedWorkRule, key: string, scope: PeriodScope = {}) {
  const window = periodWindow(rule, key);
  if (!window) return false;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(scope.start || "")) ? String(scope.start) : DEFAULT_FIXED_START;
  const [y, m, d] = start.split("-").map(Number);
  if (periodBegin(rule, key, window) < bakuMidnight(y, m - 1, d)) return false;
  const assigned = scope.assignedAt ? new Date(scope.assignedAt).getTime() : NaN;
  return Number.isNaN(assigned) || assigned < (rule.frequency === "quarterly" ? window.due : window.start);
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

export function formatBakuDateTime(ms: number) {
  const d = new Date(ms + BAKU_OFFSET_MS);
  return `${formatBakuDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatBakuDate(ms: number) {
  const d = new Date(ms + BAKU_OFFSET_MS);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function dueLabel(rule: FixedWorkRule) {
  if (rule.frequency === "daily") return `${dueDay(rule) === 1 ? "Növbəti iş günü" : "Həmin gün"} ${dueTime(rule)}`;
  if (rule.frequency === "weekly") return WEEKDAY_NAMES[Math.min(Math.max(dueDay(rule), 1), 7) - 1];
  if (isLongPeriod(rule.frequency)) return `${MONTH_ORDINALS[dueMonth(rule) - 1]} ayın ${dueDay(rule)}`;
  return String(dueDay(rule));
}
