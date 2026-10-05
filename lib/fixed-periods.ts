// Period math for "sabit işlər" (fixed monthly/weekly works), shared by the server and the page.
// Period keys are the ones already stored in work_assignment_completions: "monthly:2026-01", "weekly:2026-01-05" (the week's Monday).
// All days are counted in Baku time (UTC+4, no DST).
const BAKU_OFFSET_MS = 4 * 3600 * 1000;
const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
// Midnight (start of day) in Baku; month is 0-based and may overflow (e.g. 12 → January next year).
const bakuMidnight = (year: number, month: number, day: number) => Date.UTC(year, month, day) - BAKU_OFFSET_MS;

export type FixedWorkRule = { frequency: string; due_day: number | null };
export type PeriodState = "future" | "active" | "overdue" | "done" | "late-done" | "skipped";
// Versiya 2.89: which periods count at all — none before the counting start (admin setting, default 1 Oct 2026), and none that
// opened before the work was assigned to the person. A period that does not count is "skipped": no lateness, nothing to mark.
export type PeriodScope = { start?: string | null; assignedAt?: string | null };
export const DEFAULT_FIXED_START = "2026-10-01";

export const MONTH_NAMES = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
export const WEEKDAY_NAMES = ["Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə", "Şənbə", "Bazar"];

// Defaults: a monthly work is due on the 10th of the following month, a weekly one on Friday of the following week.
export function dueDay(rule: FixedWorkRule) { return rule.due_day || (rule.frequency === "weekly" ? 5 : 10); }

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

// When a period can be worked on: a period opens once it has ended and is due on the given day of the following period —
// a monthly work on that day of the next month (January's work: 1 Feb → 10 Feb), a weekly one (since Versiya 2.91) on that
// weekday of the next week (the week of 6–12 Oct: 13 Oct → Friday 17 Oct). `due` is the end of the deadline day.
export function periodWindow(rule: FixedWorkRule, key: string): { start: number; due: number } | null {
  const monthly = key.match(/^monthly:(\d{4})-(\d{2})$/);
  if (monthly && rule.frequency === "monthly") {
    const year = Number(monthly[1]), dueMonth = Number(monthly[2]);
    const daysInDueMonth = new Date(Date.UTC(year, dueMonth + 1, 0)).getUTCDate();
    return { start: bakuMidnight(year, dueMonth, 1), due: bakuMidnight(year, dueMonth, Math.min(dueDay(rule), daysInDueMonth) + 1) };
  }
  const weekly = key.match(/^weekly:(\d{4})-(\d{2})-(\d{2})$/);
  if (weekly && rule.frequency === "weekly") {
    const year = Number(weekly[1]), month = Number(weekly[2]) - 1, day = Number(weekly[3]);
    return { start: bakuMidnight(year, month, day + 7), due: bakuMidnight(year, month, day + 7 + Math.min(Math.max(dueDay(rule), 1), 7)) };
  }
  return null;
}

// A period counts when the period itself (the month reported on, or the week from its Monday) begins on or after the counting
// start, and the work was assigned before the period opened for work.
export function periodCounts(rule: FixedWorkRule, key: string, scope: PeriodScope = {}) {
  const window = periodWindow(rule, key);
  if (!window) return false;
  const start = /^d{4}-d{2}-d{2}$/.test(String(scope.start || "")) ? String(scope.start) : DEFAULT_FIXED_START;
  const [y, m, d] = start.split("-").map(Number);
  // The period itself: the first of the month reported on, or the week's Monday (the week opens for work a week later).
  const periodBegin = rule.frequency === "monthly" ? bakuMidnight(Number(key.slice(8, 12)), Number(key.slice(13, 15)) - 1, 1) : window.start - 7 * DAY_MS;
  if (periodBegin < bakuMidnight(y, m - 1, d)) return false;
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
  return String(dueDay(rule));
}
