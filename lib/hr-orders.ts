import {
  TERMINATION_REASONS, addDays, addMonths, formatDay, indexCalendar, isIsoDate, isWorkingDay, leaveDaysBetween, stageExtraDays, workYears,
  type CalendarDay, type HrEmployeeCalc, type HrLeaveCalc, type HrParams, type Settlement,
} from "@/lib/hr-calc";

// HR orders (əmrlər): numbering, the Labour Code basis of a leave order and its printed text. Shared by the API and the page,
// so what is printed is exactly what was registered.

export type OrderGroup = "leave" | "termination" | "other";
export const ORDER_GROUPS: { key: OrderGroup; label: string; defaultPattern: string }[] = [
  { key: "leave", label: "Məzuniyyət əmrləri", defaultPattern: "{No}-M" },
  { key: "termination", label: "İşdən çıxma əmrləri", defaultPattern: "{No}-İ" },
  { key: "other", label: "Digər əmrlər", defaultPattern: "{No}-K" },
];
export const ORDER_STATUS_LABELS: Record<string, string> = { pending: "İmzalı nüsxə gözlənilir", signed: "İmzalanıb", cancelled: "Ləğv edilib" };

// Order numbers restart every year for each firm and group; the pattern decides how the running number is written.
export function orderNumber(pattern: string, seq: number, date: string) {
  const text = (pattern || "{No}").trim() || "{No}";
  const filled = text.replace(/\{No\}/gi, String(seq)).replace(/\{İl\}|\{Il\}/gi, date.slice(0, 4)).replace(/\{Ay\}/gi, date.slice(5, 7));
  return /\{No\}/i.test(text) ? filled : `${seq}${filled ? `-${filled}` : ""}`;
}

// Azerbaijani ordinal ending of a number as written after digits: 114-cü, 116-cı, 117-ci, 119-cu, 140-cı.
export function ordinalSuffix(value: number) {
  const n = Math.abs(Math.trunc(value));
  if (n === 0) return "-cı";
  const units: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu" };
  const tens: Record<number, string> = { 1: "cu", 2: "ci", 3: "cu", 4: "cı", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cı" };
  if (n % 10) return `-${units[n % 10]}`;
  if (n % 100) return `-${tens[(n % 100) / 10]}`;
  if (n % 1000) return "-cü";
  return "-ci";
}

// "112, 113, 114 və 116-cı maddələrinə" — numbers in order, duplicates dropped, the ending taken from the last one.
export function articlesPhrase(list: string[]) {
  const numbers = [...new Set(list.flatMap((item) => item.split(/[,\s]+/)).map((x) => x.trim()).filter((x) => /^\d+(\.\d+)*$/.test(x)))]
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  if (!numbers.length) return "";
  const last = numbers[numbers.length - 1];
  const head = numbers.slice(0, -1);
  const lastNumber = Number(last.split(".").pop());
  const word = numbers.length > 1 ? "maddələrinə" : "maddəsinə";
  return `${head.length ? `${head.join(", ")} və ` : ""}${last}${ordinalSuffix(lastNumber)} ${word}`;
}

// Article numbers per leave kind, editable in the order settings: HR's lawyer checks them, a code change is never needed.
export type LeaveLegal = { annual: string; conditions: string; stage: string; women: string; parts: string; unpaid: string; social: string; study: string; other: string };
export const DEFAULT_LEAVE_LEGAL: LeaveLegal = {
  annual: "112, 113, 114", conditions: "115", stage: "116", women: "117", parts: "137",
  unpaid: "128", social: "125", study: "123, 124", other: "",
};
export function normalizeLeaveLegal(raw: unknown): LeaveLegal {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof LeaveLegal, unknown>>;
  const out = { ...DEFAULT_LEAVE_LEGAL };
  for (const key of Object.keys(out) as (keyof LeaveLegal)[]) if (typeof input[key] === "string") out[key] = (input[key] as string).trim();
  return out;
}

export const ORDER_LEAVE_KINDS: { key: string; label: string; title: string; phrase: string; paid: boolean }[] = [ // phrase is in the dative: "... buraxılsın"
  { key: "annual", label: "Əmək məzuniyyəti (illik)", title: "Əmək məzuniyyəti verilməsi haqqında", phrase: "ödənişli əmək məzuniyyətinə", paid: true },
  { key: "unpaid", label: "Ödənişsiz məzuniyyət", title: "Ödənişsiz məzuniyyət verilməsi haqqında", phrase: "ödənişsiz məzuniyyətə", paid: false },
  { key: "social", label: "Sosial məzuniyyət", title: "Sosial məzuniyyət verilməsi haqqında", phrase: "sosial məzuniyyətə", paid: true },
  { key: "study", label: "Təhsil məzuniyyəti", title: "Təhsil məzuniyyəti verilməsi haqqında", phrase: "təhsil məzuniyyətinə", paid: true },
  { key: "other", label: "Digər məzuniyyət", title: "Məzuniyyət verilməsi haqqında", phrase: "məzuniyyətə", paid: true },
];

export type OrderEmployee = HrEmployeeCalc & {
  id: number; last_name: string; first_name: string; patronymic: string | null; gender: string | null; position: string | null; department: string | null;
  company_id: number | null; extra_leave_note: string | null;
};
export type LeaveOrderInput = { kind: string; startDate: string; endDate: string; basis: string };
export type LeaveOrderPlan = {
  days: number; returnDate: string | null; workYear: { start: string; end: string } | null;
  parts: { label: string; days: number }[]; entitlement: number; articles: string; legalText: string; warnings: string[];
};

const personName = (e: OrderEmployee) => [e.last_name, e.first_name, e.patronymic].filter(Boolean).join(" ");

// Everything a leave order says, worked out from the card: days (the production calendar drops holidays from annual leave),
// the work year, the parts of the entitlement and the Labour Code articles that ground them.
export function planLeaveOrder(emp: OrderEmployee, input: LeaveOrderInput, ctx: { leaves: HrLeaveCalc[]; calendar: CalendarDay[]; params: HrParams; legal: LeaveLegal; childrenUnder14: number }): LeaveOrderPlan {
  const calendar = indexCalendar(ctx.calendar);
  const valid = isIsoDate(input.startDate) && isIsoDate(input.endDate) && input.endDate >= input.startDate;
  const warnings: string[] = [];
  const annual = input.kind === "annual";
  const days = !valid ? 0 : annual ? leaveDaysBetween(input.startDate, input.endDate, calendar, ctx.params) : Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000) + 1;
  let returnDate: string | null = null;
  if (valid) { let d = addDays(input.endDate, 1); for (let i = 0; i < 30 && !isWorkingDay(d, calendar, emp.work_week || 5); i++) d = addDays(d, 1); returnDate = d; }
  const articles: string[] = [];
  const parts: { label: string; days: number }[] = [];
  let workYear: { start: string; end: string } | null = null;
  let entitlement = 0;
  const legal = ctx.legal;
  if (annual && valid) {
    const year = workYears(emp, ctx.leaves, ctx.params, input.startDate).find((y) => y.start <= input.startDate && input.startDate <= y.end) || null;
    const base = emp.base_leave_days ?? ctx.params.baseLeaveDays;
    const stage = year ? stageExtraDays(year.stageYears, ctx.params) : 0;
    const extra = emp.extra_leave_days || 0;
    const womenRight = (emp.gender || "") === "Qadın" && ctx.childrenUnder14 >= 2;
    workYear = year ? { start: year.start, end: year.end } : null;
    entitlement = base + stage + extra;
    articles.push(legal.annual);
    parts.push({ label: "əsas məzuniyyət", days: base });
    if (stage) { articles.push(legal.stage); parts.push({ label: "əmək stajına görə əlavə məzuniyyət", days: stage }); }
    if (extra) {
      if (womenRight) articles.push(legal.women);
      parts.push({ label: womenRight ? "uşaqlı qadınlara əlavə məzuniyyət" : `əlavə məzuniyyət${emp.extra_leave_note ? ` (${emp.extra_leave_note})` : ""}`, days: extra });
    }
    if (days && days < entitlement) {
      articles.push(legal.parts);
      if (days < 14) warnings.push("Əmək məzuniyyəti hissələrə bölünəndə hissələrdən biri ən azı 14 təqvim günü olmalıdır — bu hissənin 14 gündən az olduğunu yoxlayın.");
    }
    if (days > entitlement) warnings.push(`Gün sayı (${days}) bu iş ili üçün hüquqdan (${entitlement} gün) çoxdur — əvvəlki illərin istifadə olunmamış qalığı hesabına verildiyini yoxlayın.`);
    if (input.startDate < addMonths(emp.hire_date, 6)) warnings.push("İşçi hələ 6 ay işləməyib — ilk iş ilində əmək məzuniyyəti adətən 6 aydan sonra verilir (işçinin ərizəsi ilə tez verilə bilər).");
  } else {
    const key = (["unpaid", "social", "study", "other"] as const).find((k) => k === input.kind) || "other";
    if (legal[key]) articles.push(legal[key]);
  }
  const phrase = articlesPhrase(articles);
  const legalText = phrase ? `Azərbaycan Respublikası Əmək Məcəlləsinin ${phrase} əsasən` : "";
  if (!phrase) warnings.push("Bu məzuniyyət növü üçün Əmək Məcəlləsinin maddəsi parametrlərdə göstərilməyib.");
  return { days, returnDate, workYear, parts, entitlement, articles: articles.join(", "), legalText, warnings };
}

export type PrintableOrder = { companyName: string; manager: string | null; orderNo: string; orderDate: string; title: string; legalText: string; items: string[]; basis: string; employeeName: string };

export function leaveOrderText(emp: OrderEmployee, input: LeaveOrderInput, plan: LeaveOrderPlan) {
  const kind = ORDER_LEAVE_KINDS.find((k) => k.key === input.kind) || ORDER_LEAVE_KINDS[ORDER_LEAVE_KINDS.length - 1];
  const who = [emp.department, emp.position].filter(Boolean).join(", ");
  // The make-up of the entitlement is written only when the whole of it is given; a shorter leave is a part of it.
  const composition = !plan.entitlement ? ""
    : plan.days === plan.entitlement ? (plan.parts.length > 1 ? ` (${plan.parts.map((p) => `${p.days} gün ${p.label}`).join(", ")})` : "")
    : plan.days < plan.entitlement ? ` (${plan.entitlement} günlük illik məzuniyyət hüququnun bir hissəsi)` : "";
  const year = plan.workYear ? ` ${formatDay(plan.workYear.start)} – ${formatDay(plan.workYear.end)} iş ili üçün` : "";
  const items = [
    `${personName(emp)}${who ? ` (${who})` : ""}${year} ${formatDay(input.startDate)} tarixindən ${formatDay(input.endDate)} tarixinədək (daxil olmaqla) ${plan.days} təqvim günü${composition} müddətində ${kind.phrase} buraxılsın.`,
  ];
  if (plan.returnDate) items.push(`İşçi ${formatDay(plan.returnDate)} tarixində işə çıxsın.`);
  if (kind.paid) items.push("Mühasibatlığa tapşırılsın ki, məzuniyyət haqqını qanunvericiliyə uyğun olaraq hesablayıb ödəsin.");
  return { title: kind.title, items };
}

// ---------- termination orders ----------
// The legal basis of each termination ground is free text (clause-level references such as "68-ci maddənin 1-ci hissəsinin
// «a» bəndi" do not fit a list of numbers), editable in the order settings and checked by HR's lawyer.
export type TerminationLegal = Record<string, string>;
export const DEFAULT_TERMINATION_LEGAL: TerminationLegal = {
  own: "Azərbaycan Respublikası Əmək Məcəlləsinin 68 və 69-cu maddələrinə əsasən",
  agreement: "Azərbaycan Respublikası Əmək Məcəlləsinin 68-ci maddəsinə əsasən",
  term: "Azərbaycan Respublikası Əmək Məcəlləsinin 68-ci maddəsinə əsasən",
  liquidation: "Azərbaycan Respublikası Əmək Məcəlləsinin 68-ci maddəsinə əsasən",
  reduction: "Azərbaycan Respublikası Əmək Məcəlləsinin 68-ci maddəsinə əsasən",
  employer: "Azərbaycan Respublikası Əmək Məcəlləsinin 68-ci maddəsinə əsasən",
  other: "",
};
export function normalizeTerminationLegal(raw: unknown): TerminationLegal {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TERMINATION_LEGAL };
  for (const key of Object.keys(out)) if (typeof input[key] === "string") out[key] = (input[key] as string).trim();
  return out;
}

export type TerminationExtra = { severance: boolean; workedDays: number | null; deductOverused: boolean; settlement?: SettlementSnapshot };
export type SettlementSnapshot = { lines: { label: string; detail: string; amount: number }[]; total: number; average: { months: number; total: number; monthly: number; daily: number; rows: { period: string; amount: number | null }[] }; balanceDays: number };

const MONTH_NAMES = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
export const money = (value: number) => `${value.toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
const dayText = (value: number) => String(Math.round(value * 100) / 100);

// The settlement as printed: the same lines the card's "Son hesablaşma" tab shows.
export function settlementSnapshot(result: Settlement, monthlySalary: number | null, severance: boolean, deduct: boolean, date: string): SettlementSnapshot {
  const lines = [
    { label: `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ayı üçün əmək haqqı`, detail: `${monthlySalary ? money(monthlySalary) : "vəzifə maaşı yoxdur"} × ${result.workedDays} işlənmiş gün / ${result.norm.days} iş günü (norma)`, amount: result.salaryPart },
    { label: "İstifadə olunmamış məzuniyyətə görə kompensasiya", detail: `${dayText(result.compensationDays)} gün × ${money(result.average.daily)} (orta günlük)`, amount: result.compensation },
    ...(severance ? [{ label: "İşdən çıxma müavinəti", detail: `${result.severanceMultiplier} × ${money(result.average.monthly)} (orta aylıq), bu firmada staj ${result.serviceYears} il`, amount: result.severance }] : []),
    ...(result.overusedDays > 0 ? [{ label: "Artıq istifadə olunmuş məzuniyyətə görə tutulma", detail: deduct ? `${dayText(result.overusedDays)} gün × ${money(result.average.daily)}` : `${dayText(result.overusedDays)} gün artıq istifadə olunub — tutulma seçilməyib`, amount: -result.overusedDeduction }] : []),
  ];
  return { lines, total: result.total, average: { months: result.average.months, total: result.average.total, monthly: result.average.monthly, daily: result.average.daily, rows: result.average.rows }, balanceDays: result.balance.balance };
}

export type TerminationInput = { date: string; reasonKey: string; basis: string; severance: boolean; contractNo: string | null; contractDate: string | null };
export function terminationOrderText(emp: OrderEmployee, input: TerminationInput, result: Settlement | null) {
  const who = [emp.department, emp.position].filter(Boolean).join(", ");
  const reason = TERMINATION_REASONS.find((r) => r.key === input.reasonKey)?.label || "";
  const contract = input.contractDate || input.contractNo ? ` ${[input.contractDate ? `${formatDay(input.contractDate)} tarixli` : "", input.contractNo ? `№ ${input.contractNo}` : ""].filter(Boolean).join(" ")}` : "";
  const pay = ["son iş ayında işlənmiş günlər üçün əmək haqqı"];
  if (result && result.compensationDays > 0) pay.push(`istifadə olunmamış ${dayText(result.compensationDays)} gün məzuniyyətə görə kompensasiya`);
  if (input.severance) pay.push("işdən çıxma müavinəti");
  const items = [
    `${personName(emp)}${who ? ` (${who})` : ""} ilə bağlanmış${contract} əmək müqaviləsinə ${formatDay(input.date)} tarixindən ${reason ? reason.charAt(0).toLocaleLowerCase("az") + reason.slice(1) : ""} xitam verilsin.`,
    `Mühasibatlığa tapşırılsın ki, işçi ilə son hesablaşma aparılsın: ${pay.join(", ")} ödənilsin${result && result.overusedDays > 0 ? ", artıq istifadə olunmuş məzuniyyət günləri qanunvericiliyə uyğun nəzərə alınsın" : ""}.`,
    "Əmək müqaviləsinə xitam verilməsi barədə bildiriş qanunvericiliklə müəyyən edilmiş qaydada elektron informasiya sisteminə daxil edilsin.",
  ];
  return { title: "Əmək müqaviləsinə xitam verilməsi haqqında", items };
}

// ---------- other orders (text read from a "Digər əmr" template) ----------
// Placeholders a template may use; they are filled from the worker's card when the template is picked.
export const ORDER_TEMPLATE_TOKENS = ["TamAd", "Soyad", "Ad", "AtaAdı", "Vəzifə", "Şöbə", "Firma", "İşəQəbulTarixi", "ƏmrTarixi", "Rəhbər"];
export function fillOrderTemplate(text: string, values: Record<string, string>) {
  const known = new Map(Object.entries(values).map(([k, v]) => [k.toLocaleLowerCase("az"), v]));
  const missing = new Set<string>();
  const filled = text.replace(/\{([^{}\n]{1,40})\}/g, (whole, name: string) => {
    const value = known.get(name.trim().toLocaleLowerCase("az"));
    if (value === undefined) { missing.add(name.trim()); return whole; }
    return value;
  });
  return { text: filled, missing: [...missing] };
}
