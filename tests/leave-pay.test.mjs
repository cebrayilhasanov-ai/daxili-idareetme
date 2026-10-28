import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

// Versiya 3.60: the leave pay, average earnings, compensation and payroll tax rules (lib/decimal, lib/hr-calc, lib/leave-pay,
// lib/payroll-calc). Every expected figure below is worked out by hand from Əmək Məcəlləsi 114.6, 111.1, 140, the Tax Code 101/102
// and the insurance laws, not copied from the code.
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, logLevel: "error", resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { Dec, allocateCents } = await vite.ssrLoadModule("/lib/decimal.ts");
const hr = await vite.ssrLoadModule("/lib/hr-calc.ts");
const lp = await vite.ssrLoadModule("/lib/leave-pay.ts");
const pc = await vite.ssrLoadModule("/lib/payroll-calc.ts");

const params = hr.normalizeParams({});
const calendar = (days) => hr.indexCalendar(days.map(([date, kind, name]) => ({ date, kind, name: name || null })));
// 2026 holidays that the cases below meet.
const CAL_2026 = calendar([
  ["2026-03-20", "holiday", "Novruz / Ramazan"], ["2026-03-21", "holiday", "Novruz / Ramazan"], ["2026-03-22", "holiday", "Novruz"], ["2026-03-23", "holiday", "Novruz"], ["2026-03-24", "holiday", "Novruz"],
  ["2026-03-25", "dayoff", "Köçürülmüş istirahət günü"],
  ["2026-05-27", "holiday", "Qurban"], ["2026-05-28", "holiday", "Qurban / Müstəqillik"],
  ["2026-06-15", "holiday", "Milli Qurtuluş"], ["2026-06-26", "holiday", "Silahlı Qüvvələr"],
  ["2026-11-08", "holiday", "Zəfər"], ["2026-11-09", "holiday", "Bayraq"], ["2026-11-10", "dayoff", "Köçürülmüş istirahət günü"],
]);
// Monthly earnings that count towards the average, `amount` per month from `from` to `to` (YYYY-MM).
function months(from, to, amount, extra = {}) {
  const rows = [];
  for (let p = from; p <= to; p = hr.addMonths(`${p}-01`, 1).slice(0, 7)) rows.push({ period: p, amount: extra[p]?.amount ?? amount, replace_reason: extra[p]?.reason ?? null, parts: extra[p]?.parts ?? null });
  return rows;
}
const sumCents = (list) => list.reduce((total, x) => total.add(x), Dec.zero).toNumber();

// ---------------------------------------------------------------- exact arithmetic and rounding
test("Dec keeps decimal values exact and rounds half away from zero only at the end", () => {
  assert.equal(Dec.of(0.1).add(0.2).cmp("0.3"), 0);
  assert.equal(Dec.of("2.675").toFixed(2), "2.68"); // a binary float would give 2.67
  assert.equal(Dec.of("-2.675").toFixed(2), "-2.68");
  assert.equal(Dec.of(1000).div(12).div("30.4").mul(12).mul("30.4").cmp(1000), 0); // no loss through ÷12 ÷30,4
  assert.equal(Dec.of(1000).div("30.4").toFixed(6), "32.894737");
  assert.throws(() => Dec.of("abc"));
  assert.throws(() => Dec.of(Number.NaN));
});

test("allocateCents splits a total so the parts add up to it to the qəpik", () => {
  const parts = allocateCents(Dec.of(100), [Dec.of(1), Dec.of(1), Dec.of(1)]);
  assert.deepEqual(parts.map((p) => p.toNumber()), [33.34, 33.33, 33.33]);
  const uneven = allocateCents(Dec.of("1026.32"), [Dec.of(1000).div("30.4").mul(12), Dec.of(1000).div("30.4").mul(19)]);
  assert.equal(sumCents(uneven), 1026.32);
});

// ---------------------------------------------------------------- average earnings (140)
test("full 12 months: base is the 12 calendar months before the leave month, monthly ÷ 12, daily ÷ 30,4", () => {
  const emp = { hire_date: "2020-02-01", termination_date: null };
  const salaries = [...months("2025-06", "2026-05", 1000, { "2025-12": { amount: 1600 } }), { period: "2026-06", amount: 9999 }, { period: "2025-05", amount: 9999 }];
  const a = hr.legalAverage(emp, salaries, "2026-06-10", params);
  assert.equal(a.basePeriod.from, "2025-06");
  assert.equal(a.basePeriod.to, "2026-05");
  assert.equal(a.months, 12);
  assert.equal(a.total, 12600);
  assert.equal(a.monthly, 1050);
  assert.equal(a.exact.daily.toFixed(6), "34.539474"); // 1050 / 30,4
  assert.equal(a.complete, true);
});

test("less than 12 months: only the full calendar months of employment (140.2)", () => {
  const emp = { hire_date: "2026-01-13", termination_date: null };
  const salaries = [{ period: "2026-01", amount: 700 }, ...months("2026-02", "2026-08", 1500)];
  const a = hr.legalAverage(emp, salaries, "2026-09-01", params);
  assert.equal(a.fewerThanFull, true);
  assert.equal(a.months, 7); // February – August; January is not a full month
  assert.equal(a.monthly, 1500);
  assert.equal(a.base.find((b) => b.period === "2026-01").status, "partial");
  assert.ok(a.legal.some((l) => l.includes("2-ci hissəsi")));
});

test("hired on the 1st: that month is a full one", () => {
  const a = hr.legalAverage({ hire_date: "2026-03-01" }, months("2026-03", "2026-08", 1200), "2026-09-14", params);
  assert.equal(a.months, 6);
  assert.equal(a.monthly, 1200);
});

test("months of 140.1 are replaced by the nearest earlier fully worked months (from 16.01.2026)", () => {
  const emp = { hire_date: "2023-01-01" };
  const salaries = months("2024-01", "2026-02", 1000, {
    "2025-05": { amount: 0, reason: "unpaid_employer" },
    "2025-06": { amount: 300, reason: "social_partial" },
  });
  const a = hr.legalAverage(emp, salaries, "2026-03-02", params);
  assert.equal(a.months, 12);
  assert.equal(a.total, 12000);
  assert.equal(a.monthly, 1000);
  const replaced = a.base.filter((b) => b.status === "replaced").map((b) => [b.period, b.replacedBy]);
  assert.deepEqual(replaced, [["2025-05", "2025-02"], ["2025-06", "2025-01"]]);
  assert.ok(a.base.find((b) => b.period === "2025-02").status === "replacement");
  assert.ok(a.legal.some((l) => l.includes("332-VIIQD")));
});

test("before 16.01.2026 the months are not replaced (the rule was not yet in force)", () => {
  const salaries = months("2024-01", "2025-12", 1000, { "2025-05": { amount: 0, reason: "unpaid_employer" }, "2025-06": { amount: 300, reason: "social_partial" } });
  const a = hr.legalAverage({ hire_date: "2023-01-01" }, salaries, "2026-01-05", params);
  assert.equal(a.months, 12);
  assert.equal(a.total, 10300);
  assert.equal(a.exact.monthly.toFixed(4), "858.3333");
});

test("a month to replace with no earlier fully worked month is left out, with a warning", () => {
  const salaries = months("2025-03", "2026-02", 1000, { "2025-05": { amount: 200, reason: "downtime" } });
  const a = hr.legalAverage({ hire_date: "2025-03-01" }, salaries, "2026-03-10", params);
  assert.equal(a.base.find((b) => b.period === "2025-05").status, "dropped");
  assert.equal(a.months, 11);
  assert.equal(a.monthly, 1000);
  assert.ok(a.warnings.some((w) => w.includes("may 2025")));
});

test("a missing month is not taken as 0: it is reported and the result is incomplete", () => {
  const salaries = months("2025-06", "2026-05", 1200).filter((s) => s.period !== "2025-10");
  const a = hr.legalAverage({ hire_date: "2020-01-01" }, salaries, "2026-06-01", params);
  assert.deepEqual(a.missing, ["2025-10"]);
  assert.equal(a.complete, false);
  assert.equal(a.monthly, 1200); // 11 × 1200 / 11 — never 11 × 1200 / 12
  assert.ok(a.warnings.some((w) => w.includes("oktyabr 2025")));
});

test("unpaid / social leave in a month that is not marked gives a hint to choose the reason", () => {
  const leaves = [{ id: 1, kind: "unpaid", start_date: "2025-09-08", end_date: "2025-09-19", days: 12 }];
  const a = hr.legalAverage({ hire_date: "2020-01-01" }, months("2025-04", "2026-03", 1000), "2026-04-01", params, leaves);
  assert.ok(a.warnings.some((w) => w.includes("sentyabr 2025") && w.includes("ödənişsiz")));
});

// ---------------------------------------------------------------- dates (114.6)
test("an annual leave skips holidays and is longer by as many days; transferred days off count", () => {
  const end = lp.leaveEndDate("2026-03-16", 14, "annual", CAL_2026, 5, params);
  // 16–19 March (4) + 20–24 holidays (not counted) + 25 March day off (counted) … 3 April = 14 days
  assert.equal(end, "2026-04-03");
  const s = lp.leaveSchedule("annual", "2026-03-16", end, CAL_2026, 5, params);
  assert.equal(s.paidDays, 14);
  assert.equal(s.calendarDays, 19);
  assert.equal(s.holidays.length, 5);
  assert.equal(s.daysOff, 1);
  assert.equal(s.returnDate, "2026-04-06"); // 4–5 April is a weekend
  assert.equal(s.days.find((d) => d.date === "2026-03-25").counted, true);
});

test("a study leave runs in plain calendar days (114.6 is about the annual leave)", () => {
  assert.equal(lp.leaveEndDate("2026-03-16", 14, "study", CAL_2026, 5, params), "2026-03-29");
});

test("Qurban falling on another holiday is one day (the calendar keeps one entry per date)", () => {
  const s = lp.leaveSchedule("annual", "2026-05-25", "2026-05-31", CAL_2026, 5, params);
  assert.equal(s.holidays.length, 2);
  assert.equal(s.paidDays, 5);
});

// ---------------------------------------------------------------- leave pay (111, 140) and the monthly split
test("the last salary wins when it is more (111.1): the difference is paid on top of the average", () => {
  const emp = { hire_date: "2020-01-01", work_week: 5, monthly_salary: 1000 };
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-06-01", end: "2026-06-22", salaries: months("2025-06", "2026-05", 1000), calendar: CAL_2026, params });
  assert.equal(r.schedule.paidDays, 21); // 15 June is a holiday
  assert.equal(r.averageTotal, 690.79); // 1000 / 30,4 × 21
  // June 2026: 20 working days; the leave covers 15 of them → 1000 × 15 / 20
  assert.equal(r.months[0].workDays, 15);
  assert.equal(r.months[0].normDays, 20);
  assert.equal(r.floorTotal, 750);
  assert.equal(r.applied, "floor");
  assert.equal(r.total, 750);
  assert.equal(r.difference, 59.21);
});

test("variable pay and system bonuses raise the average above the last salary: the average is paid", () => {
  const emp = { hire_date: "2026-01-13", work_week: 5, monthly_salary: 1000 };
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-09-01", end: "2026-09-10", salaries: [{ period: "2026-01", amount: 600 }, ...months("2026-02", "2026-08", 1500)], calendar: CAL_2026, params });
  assert.equal(r.average.months, 7);
  assert.equal(r.daily, 49.34); // 1500 / 30,4
  assert.equal(r.averageTotal, 493.42);
  assert.equal(r.floorTotal, 363.64); // 1000 × 8 / 22
  assert.equal(r.applied, "average");
  assert.equal(r.total, 493.42);
  assert.equal(r.difference, 0);
});

test("a leave over two months is split by its days and the parts add up to the total", () => {
  const emp = { hire_date: "2020-01-01", work_week: 5, monthly_salary: 900 };
  const salaries = months("2025-07", "2026-06", 1333.33);
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-07-20", end: "2026-08-18", salaries, calendar: CAL_2026, params });
  assert.deepEqual(r.months.map((m) => [m.period, m.paidDays]), [["2026-07", 12], ["2026-08", 18]]);
  assert.equal(r.applied, "average");
  assert.equal(r.total, Dec.of("1333.33").div("30.4").mul(30).toNumber()); // 1315.79
  assert.equal(sumCents(r.months.map((m) => Dec.of(m.amount))), r.total);
  // Exact parts 526,3147… and 789,4721… round down to 1315,78; the qəpik left over goes to the larger remainder (July).
  assert.deepEqual(r.months.map((m) => m.amount), [526.32, 789.47]);
});

test("a leave over three months: each month gets its own part, the sum is exact", () => {
  const emp = { hire_date: "2020-01-01", work_week: 5, monthly_salary: 700 };
  const r = lp.leavePay({ emp, kind: "study", start: "2026-07-25", end: "2026-09-05", salaries: months("2025-07", "2026-06", 1111.11), calendar: CAL_2026, params });
  assert.deepEqual(r.months.map((m) => m.paidDays), [7, 31, 5]);
  assert.equal(sumCents(r.months.map((m) => Dec.of(m.amount))), r.total);
  assert.equal(r.total, Dec.of("1111.11").div("30.4").mul(43).toNumber());
});

test("before 16.01.2026 there is no last-salary comparison", () => {
  const emp = { hire_date: "2020-01-01", work_week: 5, monthly_salary: 5000 };
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-01-05", end: "2026-01-11", salaries: months("2025-01", "2025-12", 1000), calendar: CAL_2026, params });
  assert.equal(r.floorTotal, null);
  assert.equal(r.applied, "average");
});

test("with no earnings on record the last salary is used and the result is flagged", () => {
  const emp = { hire_date: "2026-08-10", work_week: 5, monthly_salary: 1100 };
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-09-07", end: "2026-09-11", salaries: [], calendar: CAL_2026, params });
  assert.equal(r.average.months, 0);
  assert.equal(r.applied, "floor");
  assert.equal(r.total, 250); // 1100 × 5 / 22
  assert.ok(r.warnings.length > 0);
});

// ---------------------------------------------------------------- unused leave compensation (140.4)
test("compensation uses the 12 months before the month of dismissal, with replaced months, and no last-salary floor", () => {
  const emp = { hire_date: "2023-01-01", termination_date: null, prior_experience_months: 0, base_leave_days: null, extra_leave_days: 0, opening_balance_date: "2026-01-01", opening_balance_days: 10, work_week: 5, monthly_salary: 5000 };
  const salaries = months("2024-10", "2026-09", 1216, { "2026-03": { amount: 100, reason: "downtime" } });
  const s = hr.settlement(emp, [], salaries, CAL_2026, params, { date: "2026-10-15", reasonKey: "own", severance: false, deductOverused: false });
  assert.equal(s.average.months, 12);
  assert.equal(s.average.monthly, 1216); // March 2026 replaced by September 2025
  assert.equal(s.average.daily, 40); // 1216 / 30,4
  assert.equal(s.compensation, Dec.of(40).mul(s.compensationDays).toNumber());
});

test("an approved month's one-off payments and compensation do not count towards the average", () => {
  const sheet = { norm: { days: 22, hours: 176 }, workedHours: 176, workedDays: 22 };
  const pay = pc.payrollRow({ salary: 1000, period: "2026-09", row: sheet, overtime: 0, leavePay: [], inputs: { ...pc.EMPTY_INPUTS, bonus: 200, oneOff: 300 },
    settlement: [{ hr_employee_id: 1, order_no: "1", date: "2026-09-30", amount: 400, lines: [{ label: "İstifadə olunmamış məzuniyyətə görə kompensasiya", amount: 400 }] }] });
  assert.equal(pay.gross, 1900);
  assert.equal(pay.included, 1200); // salary + system bonus
  assert.deepEqual(pay.parts.filter((p) => !p.included).map((p) => p.amount), [300, 400]);
  const a = hr.legalAverage({ hire_date: "2020-01-01" }, [...months("2025-09", "2026-08", 1000), { period: "2026-09", amount: pay.included, parts: JSON.stringify(pay.parts) }], "2026-10-01", params);
  assert.equal(a.total, 12200);
  assert.equal(a.base.find((b) => b.period === "2026-09").excluded, 700);
});

// ---------------------------------------------------------------- taxes and insurance
test("income tax 2026–2028, private non-oil sector, with the 200 ₼ exemption only at the main workplace up to 2500 ₼", () => {
  assert.equal(pc.incomeTax(1500, "2026-05"), 39); // (1500 − 200) × 3%
  assert.equal(pc.incomeTax(1500, "2026-05", "additional"), 45);
  assert.equal(pc.incomeTax(2500, "2026-05"), 69);
  assert.equal(pc.incomeTax(2500.01, "2026-05"), 75); // above 2500 — no exemption: 75 ₼ + 10% of 0,01
  assert.equal(pc.incomeTax(8000, "2026-05"), 625);
  assert.equal(pc.incomeTax(9000, "2026-05"), 765); // 625 + 14% × 1000
  assert.equal(pc.incomeTax(1500, "2027-03"), 65); // 5%
  assert.equal(pc.incomeTax(9000, "2028-01"), 865); // 725 + 140
  assert.equal(pc.incomeTax(1500, "2026-05", "main", "state_oil"), 182); // 14% × 1300
  assert.equal(pc.incomeTax(3000, "2026-05", "main", "state_oil"), 475); // 350 + 25% × 500
});

test("DSMF, unemployment and medical insurance by band, employee and employer apart", () => {
  const c = pc.contributions(1500, "2026-05");
  assert.deepEqual([c.dsmf, c.unemployment, c.medical, c.employerDsmf, c.employerUnemployment, c.employerMedical], [136, 7.5, 30, 239, 7.5, 30]);
  const big = pc.contributions(9000, "2026-05");
  assert.deepEqual([big.dsmf, big.medical, big.employerDsmf, big.employerMedical], [886, 82.5, 1324, 82.5]); // 786 + 100; 50 + 32,5; 1214 + 110
  const state = pc.contributions(9000, "2026-05", "state_oil");
  assert.deepEqual([state.dsmf, state.employerDsmf, state.medical], [270, 1980, 165]);
  // vergi.az worked examples: 1500 → 1287,50 net; 9000 → 7221,50 net
  const net = (g) => Dec.of(g).sub(pc.incomeTax(g, "2026-05")).sub(pc.contributions(g, "2026-05").dsmf).sub(pc.contributions(g, "2026-05").unemployment).sub(pc.contributions(g, "2026-05").medical).toNumber();
  assert.equal(net(1500), 1287.5);
  assert.equal(net(9000), 7221.5);
});

test("leave pay is taxed together with the month's other earnings; severance on redundancy is free of income tax and DSMF", () => {
  const sheet = { norm: { days: 22, hours: 176 }, workedHours: 88, workedDays: 11 };
  const leave = [{ hr_employee_id: 1, order_no: "5-M", kind: "annual", days: 11, daily: 40, amount: 440, averageMonths: 12 }];
  const pay = pc.payrollRow({ salary: 1000, period: "2026-09", row: sheet, overtime: 0, leavePay: leave, inputs: pc.EMPTY_INPUTS });
  assert.equal(pay.gross, 940);
  assert.equal(pay.tax, Dec.of(740).mul("0.03").toNumber()); // one month, one exemption, on the sum
  const sev = pc.payrollRow({ salary: 1000, period: "2026-09", row: sheet, overtime: 0, leavePay: [], inputs: pc.EMPTY_INPUTS,
    settlement: [{ hr_employee_id: 1, order_no: "2-İ", date: "2026-09-15", amount: 2000, exempt: 2000, lines: [{ label: "İşdən çıxma müavinəti", amount: 2000 }] }] });
  assert.equal(sev.gross, 2500);
  assert.equal(sev.tax, 9); // (500 − 200) × 3%
  assert.equal(sev.dsmf, 36); // 6 + 10% × 300
  assert.equal(sev.medical, 50); // insurance other than DSMF stays on the whole gross
});

test("the leave's own tax lines show the employee's deductions and the employer's contributions apart", () => {
  const emp = { hire_date: "2020-01-01", work_week: 5, monthly_salary: 1000 };
  const r = lp.leavePay({ emp, kind: "annual", start: "2026-07-20", end: "2026-08-18", salaries: months("2025-07", "2026-06", 1216), calendar: CAL_2026, params });
  const lines = lp.leaveTaxLines(r, { monthly_salary: 1000, job_kind: "main" }, params);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.equal(Dec.of(l.amount).sub(l.withheld).toNumber(), l.net);
    assert.equal(Dec.sum([l.tax, l.dsmf, l.unemployment, l.medical]).toNumber(), l.withheld);
    assert.ok(l.employerDsmf > 0);
  }
  assert.equal(sumCents(lines.map((l) => Dec.of(l.amount))), r.total);
});

test("rates are looked up by date; a month before the table is flagged", () => {
  assert.equal(pc.ratesFor("2027-06").set.label.startsWith("2027"), true);
  assert.equal(pc.ratesFor("2031-01").set.label.startsWith("2028"), true);
  assert.notEqual(pc.ratesFor("2025-12").warning, "");
});
