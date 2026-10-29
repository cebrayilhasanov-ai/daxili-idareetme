"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileSpreadsheet, Printer, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay, indexCalendar, normalizeParams, weekday, type CalendarDay, type HrParams } from "@/lib/hr-calc";
import {
  DAY_CODES, EMPTY_INPUTS, OVERTIME_MULTIPLIER, PAYROLL_INPUT_KEYS, isHours, jobKindLabel, normalizeMark, normalizeOvertime, overtimeHours, payrollRow, periodDays, timesheetRow,
  type LeavePay, type PayrollInputs, type PayrollRow, type SettlementPay, type TimesheetLeave,
} from "@/lib/payroll-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54): per firm and month the tabel (filled automatically from the production calendar
// and leave orders; a head writes only what differs and hands it in), the overtime tabel and the payroll built from them.
// Versiya 3.55: two tabs — Tabel (overtime is a second line under each worker) and Hesablanan əməkhaqqı; whoever sees salaries
// also gets the payroll worked out live in the tabel itself.
// Versiya 3.56: the payroll in the firm's own Excel form (salary by the month's norm hours, Əsas / Əlavə place of work, final
// settlement, aliment and advance after tax); both tabs can be saved as an Excel file.
// Versiya 3.60: leave pay by lib/leave-pay (12 months, replaced months, not less than the last salary, split by month), the bonus
// split into the pay system's bonus and a one-off bonus / material aid, rates by date and sector, exact arithmetic.
// Edits stay on the page until "Yadda saxla", then go to /api/hr/payroll in one request.

type Access = { allDepartments: boolean; editAll: boolean; heads: string[]; payView: boolean; payEdit: boolean };
type Emp = { id: number; last_name: string; first_name: string; patronymic: string | null; position: string | null; department: string | null; hire_date: string; termination_date: string | null; work_week: number; monthly_salary?: number | null; fin?: string | null; job_kind?: string | null };
type Sheet = { department: string; status: string; submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null; return_note: string | null };
// Rows of a month approved before Versiya 3.56 lack the newer fields.
type SnapshotRow = Omit<PayrollRow, "settlementPay" | "payable" | "parts" | "included" | "bonus" | "oneOff" | "exempt" | "rateWarning"> & { settlementPay?: number; payable?: number; hr_employee_id: number; name: string; fin?: string | null; jobKind?: string; position: string | null; department: string;
  workedDays: number; normDays: number; workedHours?: number; normHours?: number; overtime: number; inputs: PayrollInputs; leaveDetails: LeavePay[]; settlementDetails?: SettlementPay[] };
type MonthData = {
  firms: { id: number; name: string }[]; period: string; companyId: number | null; access: Access | null;
  employees?: Emp[]; calendar?: CalendarDay[]; leaves?: (TimesheetLeave & { order_no: string | null; order_id: number | null })[]; params?: HrParams; departments?: Sheet[];
  marks?: { hr_employee_id: number; marks: Record<string, string>; overtime: Record<string, number> }[];
  payroll?: { status: string; approved_by: string | null; approved_at: string | null; snapshot: SnapshotRow[] | null };
  leavePay?: LeavePay[]; settlementPay?: SettlementPay[]; inputs?: (PayrollInputs & { hr_employee_id: number })[];
};
type Edit = { marks: Record<string, string>; overtime: Record<string, string> };
type InputEdit = Record<string, string>;

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const WEEKDAYS = ["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"];
const STATUS: Record<string, string> = { draft: "Doldurulur", submitted: "Təqdim edilib", accepted: "Qəbul edilib", returned: "Geri qaytarılıb" };
const periodLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const personName = (e: { last_name: string; first_name: string; patronymic: string | null }) => [e.last_name, e.first_name, e.patronymic].filter(Boolean).join(" ");
const deptName = (name: string) => name || "Şöbə göstərilməyib";
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const num = (value: number) => value.toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/\s+/g, "_").slice(0, 60) || "firma";

// One worker of the payroll, whether worked out live or taken from an approved month.
type PayRow = { id: number; name: string; fin: string | null; jobKind: string; position: string | null; department: string; workedHours: number | null; normHours: number | null; overtime: number;
  inputs: PayrollInputs; leavePay: LeavePay[]; settlement: SettlementPay[]; pay: PayrollRow };
type PayColumn = { key: string; label: string; kind: "text" | "money" | "hours"; width: number; value: (r: PayRow) => unknown; total?: boolean; strong?: boolean; input?: (typeof PAYROLL_INPUT_KEYS)[number] };
const col = (key: string, label: string, kind: PayColumn["kind"], width: number, value: PayColumn["value"], more: Partial<PayColumn> = {}): PayColumn => ({ key, label, kind, width, value, total: kind !== "text", ...more });
// The columns and their groups as in the firm's Excel payroll (A-M; Versiya 3.58: Şöbə and Vəzifəsi in separate columns); a group without a label is one column over both header rows.
const PAY_GROUPS: { label?: string; columns: PayColumn[] }[] = [
  { columns: [col("no", "№", "text", 5, () => "")] },
  { columns: [col("fin", "FİN", "text", 10, (r) => r.fin || "")] },
  { columns: [col("name", "Soyadı, adı, atasının adı", "text", 30, (r) => r.name)] },
  { columns: [col("department", "Şöbə", "text", 20, (r) => r.department)] },
  { columns: [col("post", "Vəzifəsi", "text", 22, (r) => r.position || "")] },
  { columns: [col("job", "İş yeri", "text", 8, (r) => jobKindLabel(r.jobKind))] },
  { columns: [col("salary", "Vəzifə maaşı (ştat üzrə)", "money", 11, (r) => r.pay.salary)] },
  { label: "HESABLANIB", columns: [
    col("hours", "Faktiki iş saatları", "hours", 9, (r) => r.workedHours),
    col("salaryPart", "Hesablanmış əmək haqqı", "money", 11, (r) => r.pay.salaryPart),
    col("overtimePay", "Əlavə saat", "money", 10, (r) => r.pay.overtimePay),
    col("bonus", "Mükafat", "money", 11, (r) => r.inputs.bonus, { input: "bonus" }),
    col("oneOff", "Birdəfəlik mükafat / Maddi yardım", "money", 11, (r) => r.inputs.oneOff, { input: "oneOff" }),
    // Versiya 3.61: leave pay and the final settlement in separate columns — they are taxed differently.
    col("leave", "Məzuniyyət haqqı", "money", 11, (r) => r.pay.leavePay),
    col("settlement", "Son hesablaşma (kompensasiya, müavinət)", "money", 12, (r) => r.pay.settlementPay),
  ] },
  { columns: [col("gross", "CƏMİ", "money", 11, (r) => r.pay.gross, { strong: true })] },
  { label: "TUTULMUŞDUR", columns: [
    col("tax", "Gəlir vergisi", "money", 10, (r) => r.pay.tax),
    col("dsmf", "Pensiya Fondu", "money", 10, (r) => r.pay.dsmf),
    col("unemployment", "İ.S.H.", "money", 9, (r) => r.pay.unemployment),
    col("medical", "İ.T.S.H.", "money", 9, (r) => r.pay.medical),
    col("withheld", "CƏMİ tutulmuşdur", "money", 11, (r) => r.pay.withheld, { strong: true }),
  ] },
  { label: "İşəgötürən tərəfindən", columns: [
    col("employerDsmf", "Pensiya Fondu", "money", 10, (r) => r.pay.employerDsmf),
    col("employerUnemployment", "İ.S.H.", "money", 9, (r) => r.pay.employerUnemployment),
    col("employerMedical", "İ.T.S.H.", "money", 9, (r) => r.pay.employerMedical),
  ] },
  { columns: [col("payable", "Ödənilməli məbləğ", "money", 11, (r) => r.pay.payable, { strong: true })] },
  { columns: [col("alimony", "Aliment", "money", 10, (r) => r.inputs.alimony, { input: "alimony" })] },
  { columns: [col("advance", "Ödənilmiş avans", "money", 10, (r) => r.inputs.advance, { input: "advance" })] },
  { columns: [col("net", "Qalıq məbləğ", "money", 11, (r) => r.pay.net, { strong: true })] },
];
const PAY_COLUMNS = PAY_GROUPS.flatMap((g) => g.columns);
const PAY_AT = (key: string) => PAY_COLUMNS.findIndex((c) => c.key === key);
// Consecutive rows of one department (the rows come sorted by department, as in the tabel).
function byDepartment(list: PayRow[]) {
  const out: { department: string; rows: { r: PayRow; n: number }[] }[] = [];
  list.forEach((r, i) => {
    const last = out[out.length - 1];
    if (last && last.department === r.department) last.rows.push({ r, n: i + 1 });
    else out.push({ department: r.department, rows: [{ r, n: i + 1 }] });
  });
  return out;
}
const shown = (c: PayColumn, value: unknown) => value === null || value === undefined ? "—" : c.kind === "hours" ? String(value) : Number(value) ? num(Number(value)) : "—";
// The month's norm hours of a 5-day week — the one most workers have — for the summary under the table.
function normHoursOf(list: PayRow[]) {
  const counts = new Map<number, number>();
  for (const r of list) if (r.normHours !== null) counts.set(r.normHours, (counts.get(r.normHours) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

type XCell = { value?: string | number; type?: NumberConstructor | StringConstructor; format?: string; fontWeight?: "bold"; fontSize?: number; backgroundColor?: string; textColor?: string; wrap?: boolean;
  align?: "left" | "center" | "right"; alignVertical?: "top" | "center" | "bottom"; borderStyle?: "thin"; columnSpan?: number; rowSpan?: number };
async function saveWorkbook(sheets: { data: (XCell | null)[][]; sheet: string; columns: { width: number }[]; stickyRowsCount?: number }[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  await writeXlsxFile(sheets).toFile(fileName);
}

function printTable(title: string, subtitle: string, head: string, body: string, extra = "") {
  const w = window.open("", "_blank", "width=1200,height=800");
  if (!w) { window.alert("Çap pəncərəsi açılmadı — brauzerdə bu sayt üçün açılan pəncərələrə icazə verin."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:10mm}body{font:10px/1.35 Arial,sans-serif;color:#000;margin:0}h1{font-size:14px;text-align:center;margin:0 0 2px}p.sub{text-align:center;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:2px 3px;text-align:center}td.l,th.l{text-align:left}td.n{text-align:right;white-space:nowrap}th{background:#eee}
    tr.dept td{background:#f4f4f4;font-weight:bold;text-align:left}tr.total td{font-weight:bold}tr.sub td{font-weight:bold;background:#fafafa}.off{background:#f0f0f0}.sign{display:flex;justify-content:space-between;margin-top:28px;font-size:11px}
    .sumblock{display:flex;gap:48px;margin-top:16px}.sumblock table{width:auto}.sumblock td{border:0;padding:1px 6px}
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p><table><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="sign"><span>Tərtib etdi: ____________________</span><span>Struktur bölmənin rəhbəri: ____________________</span><span>Baş mühasib: ____________________</span></div>${extra}
  <script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
}

async function fetchMonth(companyId?: number | null, period?: string): Promise<MonthData> {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", String(companyId));
  if (period) query.set("period", period);
  const response = await fetch(`/api/hr/payroll?${query}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Əməkhaqqı cədvəlləri açılmadı.");
  return body;
}

export function PayrollPage() {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"tabel" | "payroll">("tabel");
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [inputEdits, setInputEdits] = useState<Record<number, InputEdit>>({});
  const load = async (companyId?: number | null, period?: string) => {
    try { setData(await fetchMonth(companyId, period)); setEdits({}); setInputEdits({}); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Əməkhaqqı cədvəlləri açılmadı."); }
  };
  useEffect(() => {
    let cancelled = false;
    void fetchMonth().then((body) => { if (!cancelled) setData(body); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Əməkhaqqı cədvəlləri açılmadı."); });
    return () => { cancelled = true; };
  }, []);
  const send = async (payload: Record<string, unknown>) => {
    if (!data?.companyId) return false;
    setBusy(true);
    try {
      const response = await fetch("/api/hr/payroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: data.companyId, period: data.period, ...payload }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Əməliyyat baş tutmadı.");
      setData(body); setEdits({}); setInputEdits({});
      return true;
    } catch (e) { window.alert(e instanceof Error ? e.message : "Əməliyyat baş tutmadı."); return false; }
    finally { setBusy(false); }
  };
  const dirty = Object.keys(edits).length + Object.keys(inputEdits).length;
  const leaveGuard = () => !dirty || window.confirm("Yadda saxlanmamış dəyişikliklər itəcək. Davam edilsin?");

  if (error) return <section className="panel pagepanel directorypanel"><div className="errorbox">{error}</div></section>;
  if (!data) return <section className="panel pagepanel directorypanel"><div className="loading">Əməkhaqqı cədvəlləri yüklənir...</div></section>;
  const head = <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Əməkhaqqı cədvəlləri</h2><p>Tabel istehsalat təqvimi və məzuniyyət əmrlərinə görə avtomatik dolur; şöbə rəhbəri yalnız fərqləri yazır və təqdim edir</p></div></div>;
  if (!data.access || !data.companyId) return <section className="panel pagepanel directorypanel">{head}<div className="empty"><p>Tabel yalnız şöbə rəhbərlərinə (öz şöbəsi) və Giriş icazələrində “Əməkhaqqı cədvəlləri” verilmiş işçilərə açıqdır.</p></div></section>;
  const access = data.access;
  const shownTab = tab === "payroll" && !access.payView ? "tabel" : tab;
  return <section className="panel pagepanel directorypanel payrollpage">
    {head}
    <div className="payrolltoolbar">
      {data.firms.length > 1 && <label>Firma<select value={data.companyId} onChange={(e) => { if (leaveGuard()) void load(Number(e.target.value), data.period); }}>{data.firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {data.firms.length === 1 && <b>{data.firms[0].name}</b>}
      <label>Ay<input type="month" value={data.period} onChange={(e) => { if (e.target.value && leaveGuard()) void load(data.companyId, e.target.value); }} /></label>
      <div className="fixedsubtabs hrtabs">
        <button className={shownTab === "tabel" ? "on" : ""} onClick={() => setTab("tabel")}>Tabel</button>
        {access.payView && <button className={shownTab === "payroll" ? "on" : ""} onClick={() => setTab("payroll")}>Hesablanan əməkhaqqı</button>}
      </div>
    </div>
    {!data.employees?.length ? <div className="empty"><p>{periodLabel(data.period)} ayında görünən işçi yoxdur (statusu “İşləyir” olan, firması və şöbəsi kartda göstərilmiş işçilər).</p></div>
      : <MonthView key={`${data.companyId}-${data.period}`} data={data as Required<MonthData>} access={access} tab={shownTab} busy={busy} send={send}
        edits={edits} setEdits={setEdits} inputEdits={inputEdits} setInputEdits={setInputEdits} dirty={dirty} />}
  </section>;
}

function MonthView({ data, access, tab, busy, send, edits, setEdits, inputEdits, setInputEdits, dirty }: {
  data: Required<MonthData>; access: Access; tab: "tabel" | "payroll"; busy: boolean; send: (payload: Record<string, unknown>) => Promise<boolean>;
  edits: Record<number, Edit>; setEdits: React.Dispatch<React.SetStateAction<Record<number, Edit>>>; inputEdits: Record<number, InputEdit>; setInputEdits: React.Dispatch<React.SetStateAction<Record<number, InputEdit>>>; dirty: number;
}) {
  const params = useMemo(() => normalizeParams(data.params), [data.params]);
  const calendar = useMemo(() => indexCalendar(data.calendar), [data.calendar]);
  const days = periodDays(data.period);
  const approved = data.payroll.status === "approved";
  // Versiya 3.61: the second header row of the payroll sticks right under the first, whatever height the first wraps to.
  const headRef = useRef<HTMLTableRowElement>(null);
  const [headTop, setHeadTop] = useState(31);
  useEffect(() => {
    const row = headRef.current;
    if (!row) return;
    const fit = () => setHeadTop(row.getBoundingClientRect().height);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(row);
    return () => watch.disconnect();
  }, [tab]);
  const sheetOf = (name: string) => data.departments.find((d) => d.department === name);
  const canEdit = (name: string) => {
    const s = sheetOf(name)?.status || "draft";
    if (approved || s === "accepted") return false;
    return access.editAll || (access.heads.includes(name) && (s === "draft" || s === "returned"));
  };
  // The stored marks with the page's edits on top; an edit that is not valid stays as typed (shown red, blocks saving).
  const rows = useMemo(() => data.employees.map((emp) => {
    const stored = data.marks.find((m) => m.hr_employee_id === emp.id);
    const edit = edits[emp.id];
    const marks: Record<string, string> = { ...(stored?.marks || {}) };
    for (const [day, value] of Object.entries(edit?.marks || {})) { const v = normalizeMark(value); if (v) marks[day] = v; else delete marks[day]; }
    const overtime: Record<string, number> = { ...(stored?.overtime || {}) };
    for (const [day, value] of Object.entries(edit?.overtime || {})) { const v = normalizeOvertime(value); if (v) overtime[day] = v; else delete overtime[day]; }
    return { emp, department: String(emp.department || "").trim(), sheet: timesheetRow(emp, data.period, data.leaves, marks, calendar, params), overtime, edit };
  }), [data, edits, calendar, params]);
  const groups = data.departments.map((d) => ({ sheet: d, rows: rows.filter((r) => r.department === d.department) }));
  const numberOf = new Map(groups.flatMap((g) => g.rows).map((r, i) => [r.emp.id, i + 1]));
  const invalid = Object.values(edits).some((e) => Object.values(e.marks).some((v) => normalizeMark(v) === null) || Object.values(e.overtime).some((v) => normalizeOvertime(v) === null));
  const save = async () => {
    if (invalid) { window.alert("Qırmızı xanalarda yazılan qəbul edilmir: saat (0–24) və ya E, Q, X, İ yazın; əlavə saat 0–24 arası olmalıdır."); return; }
    if (Object.keys(edits).length) {
      const payload = rows.filter((r) => r.edit).map((r) => {
        const stored = data.marks.find((m) => m.hr_employee_id === r.emp.id);
        const marks: Record<string, string> = { ...(stored?.marks || {}) };
        for (const [day, value] of Object.entries(r.edit!.marks)) { const v = normalizeMark(value); if (v) marks[day] = v; else delete marks[day]; }
        return { hrEmployeeId: r.emp.id, marks, overtime: r.overtime };
      });
      if (!(await send({ action: "marks", rows: payload }))) return;
    }
    if (Object.keys(inputEdits).length) {
      await send({ action: "inputs", rows: Object.entries(inputEdits).map(([id, values]) => ({ hrEmployeeId: Number(id), ...inputsOf(Number(id)), ...values })) });
    }
  };
  const inputsOf = (id: number): PayrollInputs => ({ ...EMPTY_INPUTS, ...(data.inputs.find((i) => i.hr_employee_id === id) || {}) });
  const setMark = (empId: number, kind: "marks" | "overtime", day: string, value: string) => setEdits((current) => {
    const edit = current[empId] || { marks: {}, overtime: {} };
    return { ...current, [empId]: { ...edit, [kind]: { ...edit[kind], [day]: value } } };
  });
  const status = async (department: string, next: string) => {
    if (dirty) { window.alert("Əvvəlcə dəyişiklikləri yadda saxlayın."); return; }
    let note: string | null = "";
    if (next === "return") { note = window.prompt("Geri qaytarmanın səbəbi:"); if (!note?.trim()) return; }
    if (next === "submit" && !window.confirm(`"${deptName(department)}" şöbəsinin ${periodLabel(data.period)} tabeli mühasibatlığa təqdim edilsin? Təqdimdən sonra yalnız mühasibatlıq geri qaytarsa dəyişmək olar.`)) return;
    await send({ action: "status", department, status: next, note });
  };
  const dayHead = days.map((d) => { const off = calendar.get(d)?.kind === "holiday" || weekday(d) > 5; return <th key={d} className={off ? "off" : ""} title={calendar.get(d)?.name || ""}>{Number(d.slice(8))}<small>{WEEKDAYS[weekday(d) - 1]}</small></th>; });


  const statusBar = <div className="tabelstatuses">{groups.map(({ sheet }) => <div key={sheet.department} className={`tabelstatus ${sheet.status}`}>
    <b>{deptName(sheet.department)}</b><span className="chip">{STATUS[sheet.status] || sheet.status}</span>
    {sheet.status === "returned" && sheet.return_note && <small>Səbəb: {sheet.return_note}</small>}
    {sheet.submitted_by && sheet.status !== "draft" && <small>Təqdim etdi: {sheet.submitted_by}{sheet.submitted_at ? `, ${formatDay(sheet.submitted_at)}` : ""}</small>}
    {!approved && <span className="tabelstatusbuttons">
      {(sheet.status === "draft" || sheet.status === "returned") && (access.editAll || access.heads.includes(sheet.department)) && <Button size="sm" disabled={busy} onClick={() => void status(sheet.department, "submit")}><Send />Təqdim et</Button>}
      {access.editAll && sheet.status !== "accepted" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void status(sheet.department, "accept")}><Check />Qəbul et</Button>}
      {access.editAll && (sheet.status === "submitted" || sheet.status === "accepted") && <Button size="sm" variant="outline" disabled={busy} onClick={() => void status(sheet.department, "return")}><RotateCcw />Geri qaytar</Button>}
      {access.editAll && sheet.status === "accepted" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void status(sheet.department, "reopen")}>Qəbulu ləğv et</Button>}
    </span>}
  </div>)}</div>;

  // The tabel (N-1t); when anyone has overtime, the overtime tabel follows on its own page.
  const printSheet = () => {
    const h = escapeHtml;
    const firm = data.firms.find((f) => f.id === data.companyId)?.name || "";
    const build = (overtimeView: boolean) => {
      const headRow = `<tr><th>№</th><th class="l">Soyadı, adı, atasının adı</th><th class="l">Vəzifə</th>${days.map((d) => `<th class="${calendar.get(d)?.kind === "holiday" || weekday(d) > 5 ? "off" : ""}">${Number(d.slice(8))}</th>`).join("")}${overtimeView ? "<th>Cəmi saat</th>" : "<th>İş günü</th><th>Saat</th><th>M</th><th>X</th><th>Digər</th>"}</tr>`;
      const body = groups.map(({ sheet, rows: list }) => {
        const shown = overtimeView ? list.filter((r) => overtimeHours(r.overtime) > 0) : list;
        if (!shown.length) return "";
        return `<tr class="dept"><td colspan="${days.length + (overtimeView ? 4 : 8)}">${h(deptName(sheet.department))} — ${h(STATUS[sheet.status] || "")}</td></tr>` + shown.map((r) => {
          const cells = overtimeView ? days.map((d) => `<td>${r.overtime[d.slice(8)] || ""}</td>`).join("") : r.sheet.cells.map((c) => `<td>${h(c.value)}</td>`).join("");
          const t = r.sheet.totals;
          const totals = overtimeView ? `<td>${overtimeHours(r.overtime)}</td>` : `<td>${r.sheet.workedDays}</td><td>${r.sheet.workedHours}</td><td>${t.M}</td><td>${t.X}</td><td>${t.Ö + t.S + t.T + t.Q || ""}</td>`;
          return `<tr><td>${numberOf.get(r.emp.id)}</td><td class="l">${h(personName(r.emp))}</td><td class="l">${h(r.emp.position || "")}</td>${cells}${totals}</tr>`;
        }).join("");
      }).join("");
      return { headRow, body };
    };
    const main = build(false);
    const extra = rows.some((r) => overtimeHours(r.overtime) > 0) ? (() => {
      const ot = build(true);
      return `<div style="page-break-before:always"></div><h1>Əlavə iş saatlarının uçot tabeli</h1><p class="sub">${h(firm)} · ${h(periodLabel(data.period))}</p><table><thead>${ot.headRow}</thead><tbody>${ot.body}</tbody></table>
      <div class="sign"><span>Tərtib etdi: ____________________</span><span>Struktur bölmənin rəhbəri: ____________________</span><span>Baş mühasib: ____________________</span></div>`;
    })() : "";
    printTable("İş vaxtının uçot tabeli", `${firm} · ${periodLabel(data.period)}`, main.headRow, main.body, extra);
  };
  // The payroll in the firm's own form (Versiya 3.56): one list of columns for the screen, the print and the Excel file.
  const firmName = data.firms.find((f) => f.id === data.companyId)?.name || "";
  const payTitle = `${firmName} ${data.period.slice(0, 4)}-ci il ${MONTHS[Number(data.period.slice(5, 7)) - 1]} ayı üçün hesablanmış əmək haqqı cədvəli`;
  const payrollSummary = (list: PayRow[]) => {
    const t = (pick: (r: PayRow) => number) => sum(list, pick);
    return {
      left: [["Əmək haqqı fondu", t((r) => r.pay.gross)], ["Gəlir vergisi (işçidən tutulan)", t((r) => r.pay.tax)], ["Pensiya Fondu (işçidən tutulan)", t((r) => r.pay.dsmf)], ["İşsizlikdən sığorta haqqı (işçidən tutulan)", t((r) => r.pay.unemployment)], ["İcbari tibbi sığorta (işçidən tutulan)", t((r) => r.pay.medical)]] as [string, number][],
      right: [["Pensiya Fondu (işəgötürən tərəfindən)", t((r) => r.pay.employerDsmf)], ["İşsizlikdən sığorta haqqı (işəgötürən tərəfindən)", t((r) => r.pay.employerUnemployment)], ["İcbari tibbi sığorta (işəgötürən tərəfindən)", t((r) => r.pay.employerMedical)], ["İşəgötürənin cəmi xərci", t((r) => r.pay.employerCost)]] as [string, number][],
      normHours: normHoursOf(list),
    };
  };
  const printPayroll = () => {
    const h = escapeHtml;
    const list = payrollRows();
    const groupsRow = PAY_GROUPS.map((g) => g.label ? `<th colspan="${g.columns.length}">${h(g.label)}</th>` : `<th rowspan="2"${g.columns[0].kind === "text" ? ' class="l"' : ""}>${h(g.columns[0].label)}</th>`).join("");
    const labelsRow = PAY_GROUPS.filter((g) => g.label).flatMap((g) => g.columns).map((c) => `<th>${h(c.label)}</th>`).join("");
    const totalRow = (rows: PayRow[], label: string, cls: string) => `<tr class="${cls}">${PAY_COLUMNS.map((c, i) => i === PAY_AT("name") ? `<td class="l">${h(label)}</td>` : c.total ? `<td class="n">${shown(c, sum(rows, (r) => Number(c.value(r)) || 0))}</td>` : "<td></td>").join("")}</tr>`;
    const depts = byDepartment(list);
    const body = depts.map((d) => `<tr class="dept"><td colspan="${PAY_COLUMNS.length}">${h(deptName(d.department))}</td></tr>`
      + d.rows.map(({ r, n }) => `<tr>${PAY_COLUMNS.map((c) => c.key === "no" ? `<td>${n}</td>` : c.kind === "text" ? `<td class="l">${h(String(c.value(r) ?? ""))}</td>` : `<td class="n">${shown(c, c.value(r))}</td>`).join("")}</tr>`).join("")
      + (depts.length > 1 ? totalRow(d.rows.map((x) => x.r), `Cəmi: ${deptName(d.department)}`, "sub") : "")).join("")
      + totalRow(list, "Cəmi", "total");
    const s = payrollSummary(list);
    const line = ([label, value]: [string, number]) => `<tr><td class="l">${h(label)}</td><td class="n">${num(value)}</td></tr>`;
    const summary = `<div class="sumblock"><table>${s.left.map(line).join("")}</table><table><tr><td class="l">Ayın iş saatları</td><td class="n">${s.normHours ?? "—"}</td></tr>${s.right.map(line).join("")}</table></div>`;
    printTable(payTitle, approved ? "" : "Təsdiqlənməyib (qaralama)", `<tr>${groupsRow}</tr><tr>${labelsRow}</tr>`, body, summary);
  };
  const excelPayroll = async () => {
    const list = payrollRows();
    const head = (value: string, extra: XCell = {}): XCell => ({ value, fontWeight: "bold", backgroundColor: "#DCE6F2", align: "center", alignVertical: "center", wrap: true, borderStyle: "thin", ...extra });
    const cell = (c: PayColumn, value: unknown): XCell => c.kind === "text" ? { value: String(value ?? ""), wrap: true, borderStyle: "thin", alignVertical: "top" }
      : { value: Number(value) || 0, type: Number, format: c.kind === "hours" ? "0.##" : "#,##0.00", borderStyle: "thin", alignVertical: "top" };
    const groupsRow: (XCell | null)[] = [], labelsRow: (XCell | null)[] = [];
    for (const g of PAY_GROUPS) {
      if (!g.label) { groupsRow.push(head(g.columns[0].label, { rowSpan: 2 })); labelsRow.push(null); continue; }
      g.columns.forEach((c, i) => { groupsRow.push(i ? null : head(g.label!, { columnSpan: g.columns.length })); labelsRow.push(head(c.label)); });
    }
    const out: (XCell | null)[][] = [
      [{ value: payTitle, fontWeight: "bold", fontSize: 13, columnSpan: PAY_COLUMNS.length, align: "center" }],
      ...(approved ? [] : [[{ value: "Təsdiqlənməyib (qaralama)", textColor: "#B91C1C" }]]),
      [null], groupsRow, labelsRow,
      [null],
    ];
    const totalRow = (rows: PayRow[], label: string, fill?: string): XCell[] => PAY_COLUMNS.map((c, i): XCell => ({
      ...(i === PAY_AT("name") ? { value: label, borderStyle: "thin" } : c.total ? cell(c, sum(rows, (r) => Number(c.value(r)) || 0)) : { borderStyle: "thin" }),
      fontWeight: "bold", ...(fill ? { backgroundColor: fill } : {}) }));
    const depts = byDepartment(list);
    out.splice(out.length - 1, 0, ...depts.flatMap((d) => [
      [{ value: deptName(d.department), fontWeight: "bold", backgroundColor: "#F1F5F9", columnSpan: PAY_COLUMNS.length } as XCell],
      ...d.rows.map(({ r, n }) => PAY_COLUMNS.map((c): XCell => c.key === "no" ? { value: n, type: Number, borderStyle: "thin", alignVertical: "top" } : cell(c, c.value(r)))),
      ...(depts.length > 1 ? [totalRow(d.rows.map((x) => x.r), `Cəmi: ${deptName(d.department)}`, "#F8FAFC")] : []),
    ]), totalRow(list, "Cəmi"));
    // The summary under the table, as in the firm's Excel: the fund and the worker's deductions on the left, the employer's on the right.
    // Versiya 3.61: the amounts go into money columns (found by key), not into a narrow hours column.
    const s = payrollSummary(list);
    const right: [string, number | null, string][] = [["Ayın iş saatları", s.normHours, "0.##"], ...s.right.map(([l, v]): [string, number, string] => [l, v, "#,##0.00"])];
    const leftLabel = PAY_AT("department"), leftValue = PAY_AT("salaryPart"), rightLabel = PAY_AT("overtimePay"), rightValue = PAY_AT("gross");
    for (let i = 0; i < Math.max(s.left.length, right.length); i++) {
      const l = s.left[i], r = right[i];
      const row: (XCell | null)[] = Array.from({ length: PAY_COLUMNS.length }, () => null);
      if (l) { row[leftLabel] = { value: l[0], columnSpan: leftValue - leftLabel }; row[leftValue] = { value: l[1], type: Number, format: "#,##0.00", fontWeight: "bold" }; }
      if (r) { row[rightLabel] = { value: r[0], columnSpan: rightValue - rightLabel }; row[rightValue] = r[1] === null ? { value: "—" } : { value: r[1], type: Number, format: r[2], fontWeight: "bold" }; }
      out.push(row);
    }
    await saveWorkbook([{ data: out, sheet: "Əməkhaqqı", columns: PAY_COLUMNS.map((c) => ({ width: c.width })), stickyRowsCount: approved ? 4 : 5 }], `Əməkhaqqı_${safeName(firmName)}_${data.period}.xlsx`);
  };
  // The tabel as the firm keeps it in Excel (A-T): one row per worker, a column per day, then the totals; overtime on a second sheet.
  const excelSheet = async () => {
    const head = (value: string): XCell => ({ value, fontWeight: "bold", backgroundColor: "#DCE6F2", align: "center", alignVertical: "center", wrap: true, borderStyle: "thin" });
    const pay = access.payView;
    const lead = ["S/S", ...(pay ? ["FİN"] : []), "İşçinin tam adı", "Şöbə-vəzifəsi", "İş yeri", ...(pay ? ["Maaş"] : []), "Daxil olan", "Çıxan"];
    const leadWidths = [5, ...(pay ? [10] : []), 32, 34, 8, ...(pay ? [10] : []), 11, 11];
    const leadCells = (r: (typeof rows)[number]): XCell[] => [
      { value: numberOf.get(r.emp.id) || 0, type: Number, borderStyle: "thin" },
      ...(pay ? [{ value: r.emp.fin || "", borderStyle: "thin" } as XCell] : []),
      { value: personName(r.emp), borderStyle: "thin" }, { value: [deptName(r.department), r.emp.position].filter(Boolean).join(" — "), borderStyle: "thin" },
      { value: jobKindLabel(r.emp.job_kind), borderStyle: "thin" },
      ...(pay ? [{ value: Number(r.emp.monthly_salary) || 0, type: Number, format: "#,##0.00", borderStyle: "thin" } as XCell] : []),
      { value: formatDay(r.emp.hire_date), borderStyle: "thin" }, { value: r.emp.termination_date ? formatDay(r.emp.termination_date) : "", borderStyle: "thin" },
    ];
    const dayHeads = days.map((d): XCell => ({ ...head(String(Number(d.slice(8)))), ...(calendar.get(d)?.kind === "holiday" || weekday(d) > 5 ? { backgroundColor: "#FDE2E2" } : {}) }));
    const dayCell = (value: string | number): XCell => typeof value === "number" || isHours(value)
      ? { value: Number(String(value).replace(",", ".")), type: Number, format: "0.##", align: "center", borderStyle: "thin" } : { value, align: "center", borderStyle: "thin" };
    const width = lead.length + days.length + 2;
    const title = (text: string): XCell[] => [{ value: `${firmName} · ${periodLabel(data.period)} — ${text}`, fontWeight: "bold", fontSize: 13, columnSpan: width }];
    const tabel: (XCell | null)[][] = [title("İş vaxtının uçot tabeli"), [null], [...lead.map(head), ...dayHeads, head("Cəmi iş günü"), head("Cəmi iş saatı")]];
    const overtime: (XCell | null)[][] = [title("Əlavə iş saatlarının uçot tabeli"), [null], [...lead.map(head), ...dayHeads, head("Cəmi saat")]];
    for (const g of groups) {
      if (!g.rows.length) continue;
      tabel.push([{ value: `${deptName(g.sheet.department)} — ${STATUS[g.sheet.status] || ""}`, fontWeight: "bold", backgroundColor: "#F1F5F9", columnSpan: width }]);
      for (const r of g.rows) {
        tabel.push([...leadCells(r), ...r.sheet.cells.map((c) => dayCell(c.value)), { value: r.sheet.workedDays, type: Number, fontWeight: "bold", borderStyle: "thin" }, { value: r.sheet.workedHours, type: Number, format: "0.##", fontWeight: "bold", borderStyle: "thin" }]);
        if (overtimeHours(r.overtime) > 0) overtime.push([...leadCells(r), ...days.map((d): XCell => r.overtime[d.slice(8)] ? dayCell(r.overtime[d.slice(8)]) : { borderStyle: "thin" }), { value: overtimeHours(r.overtime), type: Number, format: "0.##", fontWeight: "bold", borderStyle: "thin" }]);
      }
    }
    const columns = [...leadWidths, ...days.map(() => 4.5), 9, 9].map((w) => ({ width: w }));
    await saveWorkbook([
      { data: tabel, sheet: "Tabel", columns, stickyRowsCount: 3 },
      ...(overtime.length > 3 ? [{ data: overtime, sheet: "Əlavə saatlar", columns, stickyRowsCount: 3 }] : []),
    ], `Tabel_${safeName(firmName)}_${data.period}.xlsx`);
  };
  const toolbar = <>
    {dirty > 0 && <span className="hint">{dirty} sətirdə yadda saxlanmamış dəyişiklik var</span>}
    {dirty > 0 && <Button variant="outline" disabled={busy} onClick={() => { setEdits({}); setInputEdits({}); }}><Undo2 />Ləğv et</Button>}
    <Button disabled={busy || !dirty} onClick={() => void save()}><Save />Yadda saxla</Button>
    <Button variant="outline" onClick={() => tab === "payroll" ? printPayroll() : printSheet()}><Printer />Çap et</Button>
    <Button variant="outline" onClick={() => void (tab === "payroll" ? excelPayroll() : excelSheet()).catch((e) => window.alert(e instanceof Error ? e.message : "Excel faylı hazırlanmadı."))}><FileSpreadsheet />Excel</Button>
  </>;


  // The payroll: an approved month as it was approved; otherwise worked out live from the tabel and the inputs on the page.
  // Versiya 3.61: in the tabel's order — by department, then as listed in it — so a worker has the same № in both tabs.
  function payrollRows(): PayRow[] {
    const place = new Map(data.departments.map((d, i) => [d.department, i]));
    return unsortedRows().map((r, i) => ({ r, i })).sort((a, b) => (place.get(a.r.department) ?? place.size) - (place.get(b.r.department) ?? place.size) || a.i - b.i).map((x) => x.r);
  }
  function unsortedRows(): PayRow[] {
    if (approved && data.payroll.snapshot) return data.payroll.snapshot.map((s) => ({ id: s.hr_employee_id, name: s.name, fin: s.fin ?? null, jobKind: s.jobKind ?? "main", position: s.position, department: s.department,
      workedHours: s.workedHours ?? null, normHours: s.normHours ?? null, overtime: s.overtime, inputs: { ...EMPTY_INPUTS, ...s.inputs }, leavePay: s.leaveDetails || [], settlement: s.settlementDetails || [],
      // Months approved before Versiya 3.56 have no payable / settlement figures of their own.
      pay: { ...s, settlementPay: s.settlementPay ?? 0, payable: s.payable ?? Math.round((s.gross - s.withheld) * 100) / 100, bonus: s.inputs?.bonus ?? 0, oneOff: s.inputs?.oneOff ?? 0, exempt: 0, included: s.gross, parts: [], rateWarning: "" } }));
    return rows.map((r) => {
      const typed = inputEdits[r.emp.id] || {};
      const base = inputsOf(r.emp.id);
      const inputs: PayrollInputs = { ...base, note: typed.note ?? base.note };
      for (const key of PAYROLL_INPUT_KEYS) { const raw = typed[key]; if (raw !== undefined) { const v = Number(String(raw).replace(",", ".")); inputs[key] = Number.isFinite(v) && v >= 0 ? v : 0; } }
      const leavePay = data.leavePay.filter((l) => l.hr_employee_id === r.emp.id);
      const settlement = (data.settlementPay || []).filter((s) => s.hr_employee_id === r.emp.id);
      const ot = overtimeHours(r.overtime);
      return { id: r.emp.id, name: personName(r.emp), fin: r.emp.fin ?? null, jobKind: r.emp.job_kind === "additional" ? "additional" : "main", position: r.emp.position, department: r.department,
        workedHours: r.sheet.workedHours, normHours: r.sheet.norm.hours, overtime: ot, inputs, leavePay, settlement,
        pay: payrollRow({ salary: r.emp.monthly_salary ?? null, period: data.period, row: r.sheet, overtime: ot, leavePay, settlement, inputs, jobKind: r.emp.job_kind, sector: data.params?.payrollSector }) };
    });
  }

  if (tab === "payroll") {
    const list = payrollRows();
    const open = data.departments.filter((d) => d.status !== "accepted");
    const editable = access.payEdit && !approved;
    const inputCell = (r: PayRow, key: (typeof PAYROLL_INPUT_KEYS)[number]) => editable
      ? <input className="payinput" inputMode="decimal" value={inputEdits[r.id]?.[key] ?? (r.inputs[key] ? String(r.inputs[key]) : "")} onChange={(e) => setInputEdits((c) => ({ ...c, [r.id]: { ...(c[r.id] || {}), [key]: e.target.value } }))} />
      : <>{r.inputs[key] ? num(r.inputs[key]) : "—"}</>;
    const titleOf = (c: PayColumn, r: PayRow) => c.key === "overtimePay" && r.overtime ? `${r.overtime} saat × ${num(r.pay.hourly)} × ${OVERTIME_MULTIPLIER}`
      : c.key === "salaryPart" && r.workedHours !== null ? `${num(r.pay.salary)} / ${r.normHours} saat × ${r.workedHours} saat`
      : c.key === "leave" ? r.leavePay.map((l) => `Məzuniyyət, əmr № ${l.order_no || "—"}${l.start ? ` (${formatDay(l.start)} – ${formatDay(l.end)})` : ""}: bu ay ${l.days} gün — ${num(l.amount)}${l.applied === "floor" ? " (111-ci maddə: sonuncu əmək haqqı üzrə" + (l.difference ? `, fərq ödənişi ${num(l.difference)} daxil` : "") + ")" : ` (orta günlük ${num(l.daily)}, ${l.averageMonths} ay)`}${l.total !== undefined && l.total !== l.amount ? `; bütün məzuniyyət ${num(l.total)}` : ""}${l.warnings?.length ? `\n⚠ ${l.warnings.join("\n⚠ ")}` : ""}`).join("\n")
      : c.key === "settlement" ? r.settlement.flatMap((s) => s.lines.map((l) => `Son hesablaşma, əmr № ${s.order_no || "—"}: ${l.label} — ${num(l.amount)}`)).join("\n")
      : c.key === "tax" && r.jobKind === "additional" ? "Əlavə iş yeri — 200 ₼ güzəşt tətbiq olunmur"
      : c.key === "tax" && r.pay.exempt ? `İşdən çıxma müavinəti ${num(r.pay.exempt)} gəlir vergisindən və DSMF-dən azaddır (Vergi Məcəlləsi 102.1.4, "Sosial sığorta haqqında" Qanun 15)` : "";
    const summary = payrollSummary(list);
    const depts = byDepartment(list);
    const totalCells = (rows: PayRow[], label: string) => PAY_COLUMNS.map((c, i) => <td key={c.key} className={c.key === "no" ? "nocol" : i === PAY_AT("name") ? "l" : "n"}>{i === PAY_AT("name") ? label : c.total ? shown(c, sum(rows, (r) => Number(c.value(r)) || 0)) : ""}</td>);
    return <>
      {approved ? <div className="hrnote">✓ Təsdiqlənib{data.payroll.approved_by ? `: ${data.payroll.approved_by}` : ""}{data.payroll.approved_at ? `, ${formatDay(data.payroll.approved_at)}` : ""}. Hesablanmış məbləğlər işçi kartlarının “Əmək haqqı” bölməsinə yazılıb.</div>
        : open.length > 0 ? <div className="hralert">⚠ Təsdiq üçün bütün şöbələrin tabeli qəbul edilməlidir. Qəbul edilməyib: {open.map((d) => deptName(d.department)).join(", ")}.</div> : null}
      <div className="payrollactions">
        {toolbar}
        {access.payEdit && access.allDepartments && (approved
          ? <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Təsdiq ləğv edilsin? Cədvəl yenidən dəyişdirilə biləcək.")) void send({ action: "unapprove" }); }}>Təsdiqi ləğv et</Button>
          : <Button disabled={busy || dirty > 0 || open.length > 0} onClick={() => { if (window.confirm(`${periodLabel(data.period)} əməkhaqqı cədvəli təsdiqlənsin?`)) void send({ action: "approve" }); }}><Check />Təsdiqlə</Button>)}
      </div>
      <h3 className="paytitle">{payTitle}</h3>
      <div className="tabelscroll"><table className="paytable" style={{ "--payhead1": `${headTop}px` } as React.CSSProperties}>
        <thead>
          <tr ref={headRef}>{PAY_GROUPS.map((g) => g.label ? <th key={g.label} colSpan={g.columns.length} className="group">{g.label}</th> : <th key={g.columns[0].key} rowSpan={2} className={`${g.columns[0].key === "name" ? "l" : g.columns[0].key === "no" ? "nocol" : ""}${g.columns[0].strong ? " strong" : ""}`}>{g.columns[0].label}</th>)}</tr>
          <tr>{PAY_GROUPS.filter((g) => g.label).flatMap((g) => g.columns).map((c) => <th key={c.key} className={c.strong ? "strong" : ""}>{c.label}</th>)}</tr>
        </thead>
        <tbody>{depts.map((d) => <Fragment key={d.department}>
          <tr className="deptrow"><td colSpan={PAY_COLUMNS.length}>{deptName(d.department)} <span>{d.rows.length} işçi</span></td></tr>
          {d.rows.map(({ r, n }) => <tr key={r.id}>{PAY_COLUMNS.map((c) => {
          if (c.key === "no") return <td key={c.key} className="nocol">{n}</td>;
          if (c.key === "name") return <td key={c.key} className="l"><b>{r.name}</b></td>;
          if (c.input) return <td key={c.key} className="n">{inputCell(r, c.input)}</td>;
          if (c.key === "salary" && !r.pay.salary) return <td key={c.key} className="n"><span className="warn" title="Kartda vəzifə maaşı yoxdur">—</span></td>;
          if (c.key === "leave" && r.leavePay.some((l) => l.complete === false)) return <td key={c.key} className="n" title={titleOf(c, r)}><span className="warn">⚠ {shown(c, c.value(r))}</span></td>;
          return <td key={c.key} className={`${c.kind === "text" ? "t" : "n"}${c.strong ? " strong" : ""}`} title={titleOf(c, r)}>{c.kind === "text" ? String(c.value(r) ?? "") : shown(c, c.value(r))}</td>;
        })}</tr>)}
          {depts.length > 1 && <tr className="subtotal">{totalCells(d.rows.map((x) => x.r), `Cəmi: ${deptName(d.department)}`)}</tr>}
        </Fragment>)}</tbody>
        <tfoot><tr>{totalCells(list, `Cəmi (${list.length} işçi)`)}</tr></tfoot>
      </table></div>
      <div className="paysummary">
        <dl>{summary.left.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{num(value)}</dd></div>)}</dl>
        <dl><div><dt>Ayın iş saatları</dt><dd>{summary.normHours ?? "—"}</dd></div>{summary.right.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{num(value)}</dd></div>)}</dl>
      </div>
      <p className="hint">Hesablanmış əməkhaqqı = vəzifə maaşı / ayın norma saatı × faktiki iş saatı (tabeldən). Əlavə saat = saat × (maaş / norma saat) × {OVERTIME_MULTIPLIER}. Məzuniyyət haqqı imzalı məzuniyyət əmrlərindən: məzuniyyətin başladığı aydan əvvəlki 12 təqvim ayının nəzərə alınan əmək haqqı ÷ 12 ÷ 30,4 × ödənilən günlər (bayramlar sayılmır), sonuncu əmək haqqından (müqavilə maaşı × məzuniyyətə düşən iş günləri / ayın iş günləri) az olmamaqla; iki aya düşəndə hər ay öz payını alır və öz gəlirləri ilə birlikdə vergiyə cəlb olunur (⚠ — hesablaşma dövründə məlumat çatışmır). Birdəfəlik mükafat / maddi yardım orta əmək haqqına daxil edilmir. Son hesablaşma imzalı xitam əmrindən (istifadə olunmamış məzuniyyətə görə kompensasiya, işdən çıxma müavinəti). Əlavə iş yerində (kartda “İş yeri: Əlavə”) gəlir vergisində 200 ₼ güzəşt tətbiq olunmur. Ödənilməli = Cəmi − tutulmuşdur; Qalıq = Ödənilməli − aliment − ödənilmiş avans. Dərəcələr ayın tarixinə və Hesablama parametrlərindəki sektora görə (Vergi Məcəlləsi 101, 102.1.6; “Sosial sığorta haqqında” 14; “Tibbi sığorta haqqında” 15-10); ləğv və ixtisar üzrə müavinət gəlir vergisindən və DSMF-dən azaddır. İSH 0,5% — mühasib yoxlamalıdır.</p>
    </>;
  }

  // Whoever sees salaries gets the month's payroll next to each worker, recalculated as the tabel is typed.
  const payOf = access.payView ? new Map(payrollRows().map((p) => [p.id, p.pay])) : null;
  const totalCols = 8 + (payOf ? 2 : 0);
  return <>
    {approved && <div className="hrnote">✓ Bu ayın əməkhaqqı cədvəli təsdiqlənib — tabel dəyişdirilmir.</div>}
    {statusBar}
    <div className="payrollactions">{toolbar}</div>
    <div className="tabelscroll"><table className="tabelgrid">
      <thead><tr><th>№</th><th className="l namecol">İşçi</th>{dayHead}<th title="İşlənmiş gün">Gün</th><th title="İşlənmiş saat">Saat</th><th title="Norma: gün / saat">Norma</th><th>M</th><th>X</th><th>E</th><th>Q</th><th title="Ödənişsiz, sosial, təhsil məzuniyyəti">Ö/S/T</th>
        {payOf && <><th className="paycol" title="Əməkhaqqı, əlavə saat, məzuniyyət haqqı, mükafat və digər əlavələr — vergidən əvvəl">Hesablanıb</th><th className="paycol" title="Vergi, ayırmalar və tutulmalardan sonra">Ödəniləcək</th></>}</tr></thead>
      <tbody>{groups.map(({ sheet, rows: list }) => <Fragment key={sheet.department}>
        <tr className="deptrow"><td colSpan={days.length + 2 + totalCols}>{deptName(sheet.department)} <span>{STATUS[sheet.status]}</span></td></tr>
        {list.map((r) => {
          const editable = canEdit(r.department);
          const t = r.sheet.totals;
          const pay = payOf?.get(r.emp.id);
          const ot = overtimeHours(r.overtime);
          return <Fragment key={r.emp.id}><tr className="mainrow">
            <td rowSpan={2}>{numberOf.get(r.emp.id)}</td><td rowSpan={2} className="l namecol"><b>{personName(r.emp)}</b><small>{r.emp.position || ""}</small></td>
            {r.sheet.cells.map((c) => {
              const day = c.date.slice(8);
              const typed = r.edit?.marks[day];
              const bad = typed !== undefined && normalizeMark(typed) === null;
              const cls = `${c.locked ? "locked" : ""}${c.manual ? " manual" : ""}${bad ? " bad" : ""} code-${c.value === "—" ? "out" : /^\d/.test(c.value) ? "h" : c.value}`;
              const leave = c.locked && c.value !== "—" ? data.leaves.find((l) => l.hr_employee_id === r.emp.id && l.start_date <= c.date && c.date <= l.end_date) : null;
              const title = leave ? `${DAY_CODES.find((x) => x.code === c.value)?.label || ""}${leave.order_no ? `, əmr № ${leave.order_no}` : ""} — dəyişmək olmaz` : c.manual ? `Avtomatik: ${c.auto}` : "";
              return <td key={c.date} className={cls} title={title}>{editable && !c.locked ? <input value={typed ?? c.value} onChange={(e) => setMark(r.emp.id, "marks", day, e.target.value)} onFocus={(e) => e.target.select()} /> : c.value}</td>;
            })}
            <td><b>{r.sheet.workedDays}</b></td><td>{r.sheet.workedHours}</td><td className="muted">{r.sheet.norm.days} / {r.sheet.norm.hours}</td>
            <td>{t.M || ""}</td><td>{t.X || ""}</td><td>{t.E || ""}</td><td>{t.Q || ""}</td><td>{t.Ö + t.S + t.T || ""}</td>
            {payOf && <><td rowSpan={2} className="paycol">{pay?.salary ? num(pay.gross) : <span className="warn" title="Kartda vəzifə maaşı yoxdur">—</span>}</td><td rowSpan={2} className="paycol strong">{pay?.salary ? num(pay.net) : "—"}</td></>}
          </tr>
          <tr className="otrow">
            {days.map((d) => {
              const day = d.slice(8);
              const typed = r.edit?.overtime[day];
              const value = typed ?? (r.overtime[day] ? String(r.overtime[day]) : "");
              const bad = typed !== undefined && normalizeOvertime(typed) === null;
              const out = r.sheet.cells.find((c) => c.date === d)?.value === "—";
              return <td key={d} className={`${out ? "out" : ""}${bad ? " bad" : ""}`} title="Əlavə saat">{editable && !out ? <input value={value} inputMode="decimal" onChange={(e) => setMark(r.emp.id, "overtime", day, e.target.value)} /> : value}</td>;
            })}
            <td colSpan={8} className="otlabel">Əlavə saat{ot ? <>: <b>{ot}</b></> : ""}</td>
          </tr></Fragment>;
        })}
      </Fragment>)}</tbody>
    </table></div>
    <div className="tabellegend">
      <span><b>Rəqəm</b> — işlənmiş saat</span>{DAY_CODES.map((c) => <span key={c.code}><b>{c.code}</b> — {c.label}</span>)}
      <span className="legendnote">Xanalar istehsalat təqvimi ilə avtomatik dolur. Yalnız fərqləri yazın: saat (məs. 4), E, Q, X və ya İ. Boz xanalar məzuniyyət əmrindən və xəstəlik vərəqəsindən gəlir — dəyişdirilmir. Xananı silsəniz, avtomatik dəyər qayıdır. Hər işçinin altındakı nazik sətir — “Əlavə saat”: iş vaxtından artıq işlənmiş saatlar, əməkhaqqında saatlıq dərəcənin {OVERTIME_MULTIPLIER} misli ilə hesablanır.{payOf ? " “Hesablanıb” və “Ödəniləcək” xana dəyişən kimi yenilənir; ətraflı hesablama “Hesablanan əməkhaqqı” tabındadır." : ""}</span>
    </div>
  </>;
}

function sum<T>(list: T[], pick: (item: T) => number) {
  return Math.round(list.reduce((total, item) => total + (Number(pick(item)) || 0), 0) * 100) / 100;
}

