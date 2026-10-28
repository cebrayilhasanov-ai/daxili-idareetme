import { Dec, allocateCents } from "@/lib/decimal";
import {
  LAW_332_IN_FORCE, addDays, formatDay, isIsoDate, isWorkingDay, legalAverage, monthEnd, monthLabel, weekday, workNorm,
  type AverageResult, type CalendarIndex, type HrLeaveCalc, type HrParams, type SalaryRow,
} from "@/lib/hr-calc";
import { contributions, incomeTax, ratesFor } from "@/lib/payroll-calc";

// Məzuniyyət haqqı (Versiya 3.60) — the pay of one leave, shared by the leave order, the payroll and the tests:
// · dates (Əmək Məcəlləsi 114.6): non-working holidays, the day of national mourning and a voting day inside an annual leave are not
//   leave days and are not paid — the leave is longer by as many days; weekends and transferred days off are ordinary calendar days;
// · the average (139, 140; Nazirlər Kabinetinin 137 nömrəli qərarı) from lib/hr-calc legalAverage, daily = monthly / 30,4;
// · 111.1 (332-VIIQD, from 16.01.2026): the pay is not less than the last salary — the salary of the contract in force when the leave
//   begins, for the working days the leave covers (the Ministry of Labour's explanation of 16.03.2026). When it is more, the
//   difference is paid on top of the average;
// · the pay is split by month (each month's leave days), the parts add up to the total to the qəpik.
// Nothing is rounded until the amounts are shown; money is lib/decimal Dec.

export type ScheduleDayType = "workday" | "weekend" | "holiday" | "dayoff" | "transfer";
export type ScheduleDay = { date: string; type: ScheduleDayType; counted: boolean; name: string | null };
export type ScheduleMonth = { period: string; paidDays: number; workDays: number; normDays: number };
export type LeaveSchedule = {
  kind: string; start: string; end: string; returnDate: string | null; calendarDays: number; paidDays: number;
  holidays: { date: string; name: string | null }[]; weekends: number; daysOff: number; workDays: number;
  days: ScheduleDay[]; months: ScheduleMonth[]; legal: string[];
};

// Holidays leave an annual leave (and stretch it); other kinds of leave run in plain calendar days.
const isAnnual = (kind: string) => kind === "annual";
function dayType(date: string, calendar: CalendarIndex, workWeek: number): ScheduleDayType {
  const special = calendar.get(date)?.kind;
  if (special === "holiday") return "holiday";
  if (special === "dayoff") return "dayoff";
  if (special === "workday") return "transfer";
  return weekday(date) <= (workWeek === 6 ? 6 : 5) ? "workday" : "weekend";
}
const counts = (type: ScheduleDayType, kind: string, params: HrParams) =>
  !isAnnual(kind) || !(type === "holiday" || (type === "dayoff" && params.excludeDayOffFromLeave));

// The last day of a leave of `days` leave days starting on `start`: an annual leave skips the holidays it meets (114.6).
export function leaveEndDate(start: string, days: number, kind: string, calendar: CalendarIndex, workWeek: number, params: HrParams): string | null {
  if (!isIsoDate(start) || !Number.isInteger(days) || days < 1 || days > 400) return null;
  let left = days, d = start;
  for (let guard = 0; guard < 800; guard++) {
    if (counts(dayType(d, calendar, workWeek), kind, params)) left -= 1;
    if (!left) return d;
    d = addDays(d, 1);
  }
  return null;
}

export function leaveSchedule(kind: string, start: string, end: string, calendar: CalendarIndex, workWeek: number, params: HrParams): LeaveSchedule | null {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null;
  const week = workWeek === 6 ? 6 : 5;
  const days: ScheduleDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const type = dayType(d, calendar, week);
    days.push({ date: d, type, counted: counts(type, kind, params), name: calendar.get(d)?.name || null });
  }
  let returnDate: string | null = addDays(end, 1);
  for (let i = 0; i < 40 && !isWorkingDay(returnDate, calendar, week); i++) returnDate = addDays(returnDate, 1);
  if (!isWorkingDay(returnDate, calendar, week)) returnDate = null;
  const months: ScheduleMonth[] = [];
  for (const day of days) {
    const period = day.date.slice(0, 7);
    let m = months.find((x) => x.period === period);
    if (!m) { m = { period, paidDays: 0, workDays: 0, normDays: workNorm(`${period}-01`, monthEnd(`${period}-01`), calendar, week, params.dailyHours).days }; months.push(m); }
    if (day.counted) m.paidDays += 1;
    if (isWorkingDay(day.date, calendar, week)) m.workDays += 1;
  }
  const legal = isAnnual(kind)
    ? ["Əmək Məcəlləsi, 114-cü maddənin 6-cı hissəsi — iş günü hesab olunmayan bayram günləri, ümumxalq hüzn günü və səsvermə günü məzuniyyət günü hesab edilmir, ödənilmir, məzuniyyət bu günlər qədər uzadılır"]
    : [];
  return {
    kind, start, end, returnDate, calendarDays: days.length, paidDays: days.filter((d) => d.counted).length,
    holidays: days.filter((d) => d.type === "holiday").map((d) => ({ date: d.date, name: d.name })),
    weekends: days.filter((d) => d.type === "weekend").length, daysOff: days.filter((d) => d.type === "dayoff").length,
    workDays: days.filter((d) => isWorkingDay(d.date, calendar, week)).length, days, months, legal,
  };
}

export type LeavePayEmployee = { hire_date: string; termination_date?: string | null; work_week: number; monthly_salary?: number | null };
export type LeavePayMonth = { period: string; paidDays: number; workDays: number; normDays: number; average: number | null; floor: number | null; amount: number };
export type LeavePayResult = {
  kind: string; schedule: LeaveSchedule; average: AverageResult; salary: number | null; daily: number | null;
  averageTotal: number | null; floorTotal: number | null; applied: "average" | "floor" | "none"; difference: number; total: number;
  months: LeavePayMonth[]; complete: boolean; warnings: string[]; legal: string[];
};

export function leavePay(input: { emp: LeavePayEmployee; kind: string; start: string; end: string; salaries: SalaryRow[]; calendar: CalendarIndex; params: HrParams; leaves?: HrLeaveCalc[] }): LeavePayResult | null {
  const { emp, kind, start, end, calendar, params } = input;
  const schedule = leaveSchedule(kind, start, end, calendar, emp.work_week || 5, params);
  if (!schedule) return null;
  const average = legalAverage(emp, input.salaries, start, params, input.leaves || []);
  const warnings = [...average.warnings];
  const legal = [...schedule.legal, ...average.legal];
  const daily = average.exact.daily;
  const salary = Number(emp.monthly_salary) > 0 ? Dec.of(Number(emp.monthly_salary)) : null;
  // 111.1 since 16.01.2026: compared with the last (contract) salary for the working days of the leave, month by month.
  const floorInForce = start >= LAW_332_IN_FORCE;
  const avgByMonth = schedule.months.map((m) => (daily ? daily.mul(m.paidDays) : null));
  const floorByMonth = schedule.months.map((m) => (floorInForce && salary && m.normDays ? salary.mul(m.workDays).div(m.normDays) : null));
  const averageExact = daily ? Dec.sum(avgByMonth as Dec[]) : null;
  const floorExact = floorInForce && salary ? Dec.sum(floorByMonth.map((f) => f || Dec.zero)) : null;
  if (floorInForce) {
    legal.push("Əmək Məcəlləsi, 111-ci maddənin 1-ci hissəsi (332-VIIQD) — orta əmək haqqı sonuncu əmək haqqından az olmamaqla saxlanılır; müqayisə məzuniyyətə düşən iş günləri üzrə qüvvədə olan əmək müqaviləsindəki əmək haqqı ilə aparılır (ƏƏSMN-in 16.03.2026 tarixli izahı)");
    if (!salary) warnings.push("Kartda vəzifə maaşı (əmək müqaviləsindəki əmək haqqı) yoxdur — 111-ci maddə üzrə sonuncu əmək haqqı ilə müqayisə aparılmadı.");
  }
  let applied: LeavePayResult["applied"] = "none";
  if (averageExact && floorExact) applied = floorExact.gt(averageExact) ? "floor" : "average";
  else if (averageExact) applied = "average";
  else if (floorExact) { applied = "floor"; warnings.push("Orta əmək haqqı hesablanmadığı üçün məzuniyyət haqqı 111-ci maddə üzrə sonuncu əmək haqqı əsasında hesablandı."); }
  const shares = applied === "floor" ? floorByMonth.map((f) => f || Dec.zero) : applied === "average" ? (avgByMonth as Dec[]) : schedule.months.map(() => Dec.zero);
  const exactTotal = applied === "floor" ? (floorExact as Dec) : applied === "average" ? (averageExact as Dec) : Dec.zero;
  const total = exactTotal.round(2);
  const parts = allocateCents(total, shares);
  const averageTotal = averageExact ? averageExact.round(2) : null;
  const difference = applied === "floor" && averageTotal ? total.sub(averageTotal) : Dec.zero;
  if (applied === "none") warnings.push("Məzuniyyət haqqı hesablana bilmədi: nə orta əmək haqqı, nə də kartda vəzifə maaşı var.");
  if (schedule.paidDays === 0) warnings.push("Bu dövrdə ödənilən məzuniyyət günü yoxdur.");
  return {
    kind, schedule, average, salary: salary ? salary.toNumber() : null, daily: daily ? daily.toNumber() : null,
    averageTotal: averageTotal ? averageTotal.toNumber() : null, floorTotal: floorExact ? floorExact.toNumber() : null, applied,
    difference: difference.toNumber(), total: total.toNumber(),
    months: schedule.months.map((m, i) => ({ ...m, average: avgByMonth[i] ? (avgByMonth[i] as Dec).toNumber() : null, floor: floorByMonth[i] ? (floorByMonth[i] as Dec).toNumber() : null, amount: parts[i].toNumber() })),
    complete: average.complete || (applied === "floor" && !average.months), warnings, legal,
  };
}

// ---------- the printed calculation ----------
const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const azn = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value.toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`);
const exact = (value: Dec | null, places = 6) => (value ? value.toFixed(places).replace(".", ",").replace(/0+$/, "").replace(/,$/, "") : "—");
const STATUS_TEXT: Record<string, string> = { counted: "Nəzərə alınıb", replacement: "Əvəzedici ay", replaced: "Əvəzlənib", dropped: "Çıxarılıb", partial: "Tam ay deyil", missing: "Məlumat yoxdur" };

export type LeavePayHeader = { name: string; position: string | null; department: string | null; company: string | null; hireDate: string; orderNo?: string | null; kindLabel: string; taxes?: LeaveTaxLine[] };
export type LeaveTaxLine = { period: string; amount: number; tax: number; dsmf: number; unemployment: number; medical: number; withheld: number; net: number; employerDsmf: number; employerUnemployment: number; employerMedical: number; note: string };

// The calculation as a printable HTML block (the leave order prints it on a page of its own; the screen shows the same figures).
export function leavePayHtml(result: LeavePayResult, head: LeavePayHeader) {
  const s = result.schedule, a = result.average;
  const meta = [
    ["İşçi", head.name], ["Vəzifə", [head.department, head.position].filter(Boolean).join(", ") || "—"], ["Firma", head.company || "—"], ["İşə qəbul tarixi", formatDay(head.hireDate)],
    ["Məzuniyyət", `${head.kindLabel}${head.orderNo ? `, əmr № ${head.orderNo}` : ""}`], ["Başlanğıc — bitmə", `${formatDay(s.start)} – ${formatDay(s.end)}`],
    ["İşə qayıtma tarixi", s.returnDate ? formatDay(s.returnDate) : "—"],
    ["Günlər", `${s.calendarDays} təqvim günü, ödənilən ${s.paidDays} gün${s.holidays.length ? `; bayram ${s.holidays.length} gün (sayılmır, ödənilmir)` : ""}; həftəsonu ${s.weekends}, köçürülmüş istirahət ${s.daysOff}; iş günü ${s.workDays}`],
  ];
  const holidays = s.holidays.length ? `<p class="note">Bayram günləri: ${s.holidays.map((h) => `${formatDay(h.date)}${h.name ? ` (${esc(h.name)})` : ""}`).join("; ")}.</p>` : "";
  const baseRows = a.base.map((b) => `<tr><td>${esc(monthLabel(b.period))}</td><td>${STATUS_TEXT[b.status] || b.status}</td><td class="n">${b.amount === null ? "—" : esc(azn(b.amount))}</td><td class="n">${b.excluded ? esc(azn(b.excluded)) : "—"}</td><td>${esc(b.note)}</td></tr>`).join("");
  const monthRows = result.months.map((m) => `<tr><td>${esc(monthLabel(m.period))}</td><td class="n">${m.paidDays}</td><td class="n">${m.workDays} / ${m.normDays}</td><td class="n">${esc(azn(m.average))}</td><td class="n">${esc(azn(m.floor))}</td><td class="n"><b>${esc(azn(m.amount))}</b></td></tr>`).join("");
  const taxRows = (head.taxes || []).map((t) => `<tr><td>${esc(monthLabel(t.period))}</td><td class="n">${esc(azn(t.amount))}</td><td class="n">${esc(azn(t.tax))}</td><td class="n">${esc(azn(t.dsmf))}</td><td class="n">${esc(azn(t.unemployment))}</td><td class="n">${esc(azn(t.medical))}</td><td class="n">${esc(azn(t.withheld))}</td><td class="n"><b>${esc(azn(t.net))}</b></td><td class="n">${esc(azn(t.employerDsmf + t.employerUnemployment + t.employerMedical))}</td></tr>`).join("");
  const sumTax = (pick: (t: LeaveTaxLine) => number) => (head.taxes || []).reduce((total, t) => total.add(pick(t)), Dec.zero).toNumber();
  return `<h2 class="left">Məzuniyyət haqqının hesablanması</h2>
    <table class="calc">${meta.map(([k, v]) => `<tr><td style="width:32%">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>${holidays}
    <h2 class="left">Hesablaşma dövrü: ${esc(monthLabel(a.basePeriod.from))} – ${esc(monthLabel(a.basePeriod.to))}${a.fewerThanFull ? " (12 aydan az əmək münasibəti — yalnız tam təqvim ayları)" : ""}</h2>
    <table class="calc"><tr><td><b>Ay</b></td><td><b>Vəziyyət</b></td><td class="n"><b>Nəzərə alınan</b></td><td class="n"><b>Nəzərə alınmayan</b></td><td><b>Qeyd</b></td></tr>${baseRows || `<tr><td colspan="5">Ay yoxdur</td></tr>`}</table>
    <table class="calc"><tr><td>Nəzərə alınan ayların sayı</td><td class="n">${a.months}</td></tr><tr><td>Cəmi</td><td class="n">${esc(azn(a.total))}</td></tr>
      <tr><td>Orta aylıq əmək haqqı (cəmi ÷ ${a.months || "—"})</td><td class="n">${esc(azn(a.monthly || null))} <small>(${exact(a.exact.monthly)})</small></td></tr>
      <tr><td>Orta gündəlik əmək haqqı (orta aylıq ÷ 30,4)</td><td class="n">${esc(azn(a.daily || null))} <small>(${exact(a.exact.daily)})</small></td></tr>
      <tr><td>Orta əmək haqqı üzrə məzuniyyət haqqı (orta gündəlik × ${s.paidDays} gün)</td><td class="n">${esc(azn(result.averageTotal))}</td></tr>
      <tr><td>Sonuncu əmək haqqı üzrə (${esc(azn(result.salary))} × iş günləri / ayın iş günləri)</td><td class="n">${esc(azn(result.floorTotal))}</td></tr>
      ${result.difference ? `<tr><td>Fərq ödənişi (111-ci maddə)</td><td class="n">${esc(azn(result.difference))}</td></tr>` : ""}
      <tr class="total"><td>Məzuniyyət haqqı (brüt)</td><td class="n">${esc(azn(result.total))}</td></tr></table>
    <h2 class="left">Aylar üzrə bölgü</h2>
    <table class="calc"><tr><td><b>Ay</b></td><td class="n"><b>Ödənilən gün</b></td><td class="n"><b>İş günü / norma</b></td><td class="n"><b>Orta əmək haqqı üzrə</b></td><td class="n"><b>Sonuncu əmək haqqı üzrə</b></td><td class="n"><b>Hesablanıb</b></td></tr>${monthRows}
      <tr class="total"><td>Cəmi</td><td class="n">${s.paidDays}</td><td></td><td class="n">${esc(azn(result.averageTotal))}</td><td class="n">${esc(azn(result.floorTotal))}</td><td class="n">${esc(azn(result.total))}</td></tr></table>
    ${taxRows ? `<h2 class="left">Vergi və sığorta (məzuniyyət haqqının öz payı — ayın digər gəlirləri ilə birlikdə əməkhaqqı cədvəlində dəqiqləşir)</h2>
    <table class="calc"><tr><td><b>Ay</b></td><td class="n"><b>Brüt</b></td><td class="n"><b>Gəlir vergisi</b></td><td class="n"><b>DSMF</b></td><td class="n"><b>İSH</b></td><td class="n"><b>İTSH</b></td><td class="n"><b>Tutulmalar</b></td><td class="n"><b>Xalis</b></td><td class="n"><b>İşəgötürən ayırmaları</b></td></tr>${taxRows}
      <tr class="total"><td>Cəmi</td><td class="n">${esc(azn(sumTax((t) => t.amount)))}</td><td class="n">${esc(azn(sumTax((t) => t.tax)))}</td><td class="n">${esc(azn(sumTax((t) => t.dsmf)))}</td><td class="n">${esc(azn(sumTax((t) => t.unemployment)))}</td><td class="n">${esc(azn(sumTax((t) => t.medical)))}</td><td class="n">${esc(azn(sumTax((t) => t.withheld)))}</td><td class="n">${esc(azn(sumTax((t) => t.net)))}</td><td class="n">${esc(azn(sumTax((t) => t.employerDsmf + t.employerUnemployment + t.employerMedical)))}</td></tr></table>
    ${(head.taxes || []).filter((t) => t.note).map((t) => `<p class="note">${esc(monthLabel(t.period))}: ${esc(t.note)}</p>`).join("")}` : ""}
    ${result.warnings.length ? `<p class="draft">${result.warnings.map((w) => `⚠ ${esc(w)}`).join("<br>")}</p>` : ""}
    <p class="note"><b>Hüquqi əsas:</b> ${result.legal.map(esc).join("; ")}.</p>`;
}

// ---------- tax and insurance of the leave pay ----------
// The leave pay of a month is taxed together with the month's other earnings (the payroll does it with the real tabel). For the
// leave's own calculation the month's other earnings are estimated from the card salary for the working days of the month not on
// leave; the month's tax and insurance are worked out on the sum and the leave pay's share of them is shown.
export function leaveTaxLines(result: LeavePayResult, emp: { monthly_salary?: number | null; job_kind?: string | null }, params: HrParams): LeaveTaxLine[] {
  const salary = Number(emp.monthly_salary) > 0 ? Dec.of(Number(emp.monthly_salary)) : Dec.zero;
  const jobKind = emp.job_kind === "additional" ? "additional" : "main";
  return result.months.filter((m) => m.amount).map((m) => {
    const other = m.normDays ? salary.mul(Math.max(0, m.normDays - m.workDays)).div(m.normDays).round(2) : Dec.zero;
    const amount = Dec.of(m.amount);
    const gross = other.add(amount);
    const share = gross.isZero() ? Dec.zero : amount.div(gross);
    const tax = Dec.of(incomeTax(gross, m.period, jobKind, params.payrollSector));
    const c = contributions(gross, m.period, params.payrollSector);
    const part = (value: number | Dec) => Dec.of(value).mul(share).round(2);
    const line = { tax: part(tax), dsmf: part(c.dsmf), unemployment: part(c.unemployment), medical: part(c.medical) };
    const withheld = Dec.sum([line.tax, line.dsmf, line.unemployment, line.medical]);
    const { warning } = ratesFor(m.period, params.payrollSector);
    return {
      period: m.period, amount: m.amount, tax: line.tax.toNumber(), dsmf: line.dsmf.toNumber(), unemployment: line.unemployment.toNumber(), medical: line.medical.toNumber(),
      withheld: withheld.toNumber(), net: amount.sub(withheld).toNumber(),
      employerDsmf: part(c.employerDsmf).toNumber(), employerUnemployment: part(c.employerUnemployment).toNumber(), employerMedical: part(c.employerMedical).toNumber(),
      note: `ayın digər gəliri təxminən ${other.toFixed(2).replace(".", ",")} ₼ (vəzifə maaşı × ${Math.max(0, m.normDays - m.workDays)} iş günü / ${m.normDays}); ayın cəmi ${gross.toFixed(2).replace(".", ",")} ₼ üzrə vergi və sığorta hesablanıb, məzuniyyət haqqına düşən payı göstərilir${jobKind === "additional" ? "; əlavə iş yeri — 200 ₼ güzəşt yoxdur" : ""}. Dəqiq məbləğ əməkhaqqı cədvəlində (tabel əsasında) çıxır.${warning ? ` ${warning}` : ""}`,
    };
  });
}
