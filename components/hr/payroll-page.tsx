"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, Printer, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay, indexCalendar, normalizeParams, weekday, type CalendarDay, type HrParams } from "@/lib/hr-calc";
import { money } from "@/lib/hr-orders";
import {
  DAY_CODES, EMPTY_INPUTS, OVERTIME_MULTIPLIER, PAYROLL_INPUT_KEYS, normalizeMark, normalizeOvertime, overtimeHours, payrollRow, periodDays, timesheetRow,
  type LeavePay, type PayrollInputs, type PayrollRow, type TimesheetLeave,
} from "@/lib/payroll-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54): per firm and month the tabel (filled automatically from the production calendar
// and leave orders; a head writes only what differs and hands it in), the overtime tabel and the payroll built from them.
// Edits stay on the page until "Yadda saxla", then go to /api/hr/payroll in one request.

type Access = { allDepartments: boolean; editAll: boolean; heads: string[]; payView: boolean; payEdit: boolean };
type Emp = { id: number; last_name: string; first_name: string; patronymic: string | null; position: string | null; department: string | null; hire_date: string; termination_date: string | null; work_week: number; monthly_salary?: number | null };
type Sheet = { department: string; status: string; submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null; return_note: string | null };
type SnapshotRow = PayrollRow & { hr_employee_id: number; name: string; position: string | null; department: string; workedDays: number; normDays: number; overtime: number; inputs: PayrollInputs; leaveDetails: LeavePay[] };
type MonthData = {
  firms: { id: number; name: string }[]; period: string; companyId: number | null; access: Access | null;
  employees?: Emp[]; calendar?: CalendarDay[]; leaves?: (TimesheetLeave & { order_no: string | null; order_id: number | null })[]; params?: HrParams; departments?: Sheet[];
  marks?: { hr_employee_id: number; marks: Record<string, string>; overtime: Record<string, number> }[];
  payroll?: { status: string; approved_by: string | null; approved_at: string | null; snapshot: SnapshotRow[] | null };
  leavePay?: LeavePay[]; inputs?: (PayrollInputs & { hr_employee_id: number })[];
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
const INPUT_LABELS: Record<(typeof PAYROLL_INPUT_KEYS)[number], string> = { bonus: "Mükafat", otherAdd: "Digər əlavə", advance: "Avans", alimony: "Aliment", otherDed: "Digər tutulma" };

function printTable(title: string, subtitle: string, head: string, body: string) {
  const w = window.open("", "_blank", "width=1200,height=800");
  if (!w) { window.alert("Çap pəncərəsi açılmadı — brauzerdə bu sayt üçün açılan pəncərələrə icazə verin."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:10mm}body{font:10px/1.35 Arial,sans-serif;color:#000;margin:0}h1{font-size:14px;text-align:center;margin:0 0 2px}p.sub{text-align:center;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:2px 3px;text-align:center}td.l,th.l{text-align:left}td.n{text-align:right;white-space:nowrap}th{background:#eee}
    tr.dept td{background:#f4f4f4;font-weight:bold;text-align:left}tr.total td{font-weight:bold}.off{background:#f0f0f0}.sign{display:flex;justify-content:space-between;margin-top:28px;font-size:11px}
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p><table><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="sign"><span>Tərtib etdi: ____________________</span><span>Struktur bölmənin rəhbəri: ____________________</span><span>Baş mühasib: ____________________</span></div>
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
  const [tab, setTab] = useState<"tabel" | "overtime" | "payroll">("tabel");
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
        <button className={shownTab === "overtime" ? "on" : ""} onClick={() => setTab("overtime")}>Əlavə saatlar</button>
        {access.payView && <button className={shownTab === "payroll" ? "on" : ""} onClick={() => setTab("payroll")}>Əməkhaqqı cədvəli</button>}
      </div>
    </div>
    {!data.employees?.length ? <div className="empty"><p>{periodLabel(data.period)} ayında görünən işçi yoxdur (statusu “İşləyir” olan, firması və şöbəsi kartda göstərilmiş işçilər).</p></div>
      : <MonthView key={`${data.companyId}-${data.period}`} data={data as Required<MonthData>} access={access} tab={shownTab} busy={busy} send={send}
        edits={edits} setEdits={setEdits} inputEdits={inputEdits} setInputEdits={setInputEdits} dirty={dirty} />}
  </section>;
}

function MonthView({ data, access, tab, busy, send, edits, setEdits, inputEdits, setInputEdits, dirty }: {
  data: Required<MonthData>; access: Access; tab: "tabel" | "overtime" | "payroll"; busy: boolean; send: (payload: Record<string, unknown>) => Promise<boolean>;
  edits: Record<number, Edit>; setEdits: React.Dispatch<React.SetStateAction<Record<number, Edit>>>; inputEdits: Record<number, InputEdit>; setInputEdits: React.Dispatch<React.SetStateAction<Record<number, InputEdit>>>; dirty: number;
}) {
  const params = useMemo(() => normalizeParams(data.params), [data.params]);
  const calendar = useMemo(() => indexCalendar(data.calendar), [data.calendar]);
  const days = periodDays(data.period);
  const approved = data.payroll.status === "approved";
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

  const printSheet = () => {
    const overtimeView = tab === "overtime";
    const h = escapeHtml;
    const headRow = `<tr><th>№</th><th class="l">Soyadı, adı, atasının adı</th><th class="l">Vəzifə</th>${days.map((d) => `<th class="${calendar.get(d)?.kind === "holiday" || weekday(d) > 5 ? "off" : ""}">${Number(d.slice(8))}</th>`).join("")}${overtimeView ? "<th>Cəmi saat</th>" : "<th>İş günü</th><th>Saat</th><th>M</th><th>X</th><th>Digər</th>"}</tr>`;
    const body = groups.map(({ sheet, rows: list }) => `<tr class="dept"><td colspan="${days.length + (overtimeView ? 4 : 8)}">${h(deptName(sheet.department))} — ${h(STATUS[sheet.status] || "")}</td></tr>` + list.map((r) => {
      const cells = overtimeView ? days.map((d) => `<td>${r.overtime[d.slice(8)] || ""}</td>`).join("") : r.sheet.cells.map((c) => `<td>${h(c.value)}</td>`).join("");
      const t = r.sheet.totals;
      const totals = overtimeView ? `<td>${overtimeHours(r.overtime)}</td>` : `<td>${r.sheet.workedDays}</td><td>${r.sheet.workedHours}</td><td>${t.M}</td><td>${t.X}</td><td>${t.Ö + t.S + t.T + t.Q || ""}</td>`;
      return `<tr><td>${numberOf.get(r.emp.id)}</td><td class="l">${h(personName(r.emp))}</td><td class="l">${h(r.emp.position || "")}</td>${cells}${totals}</tr>`;
    }).join("")).join("");
    const firm = data.firms.find((f) => f.id === data.companyId)?.name || "";
    printTable(overtimeView ? "Əlavə iş saatlarının uçot tabeli" : "İş vaxtının uçot tabeli", `${firm} · ${periodLabel(data.period)}`, headRow, body);
  };
  const printPayroll = () => {
    const h = escapeHtml;
    const list = payrollRows();
    const headRow = "<tr><th>№</th><th class=\"l\">Soyadı, adı, atasının adı</th><th class=\"l\">Vəzifə</th><th>Maaş</th><th>Norma / işlənib (gün)</th><th>Əməkhaqqı</th><th>Əlavə saat</th><th>Məzuniyyət haqqı</th><th>Mükafat, digər</th><th>Hesablanıb</th><th>Gəlir vergisi</th><th>DSMF</th><th>İşsizlik</th><th>İTS</th><th>Avans, aliment, digər</th><th>Ödənilməli</th></tr>";
    const body = list.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${h(r.name)}</td><td class="l">${h(r.position || "")}</td><td class="n">${num(r.pay.salary)}</td><td>${r.normDays} / ${r.workedDays}</td><td class="n">${num(r.pay.salaryPart)}</td><td class="n">${num(r.pay.overtimePay)}</td><td class="n">${num(r.pay.leavePay)}</td><td class="n">${num(r.inputs.bonus + r.inputs.otherAdd)}</td><td class="n">${num(r.pay.gross)}</td><td class="n">${num(r.pay.tax)}</td><td class="n">${num(r.pay.dsmf)}</td><td class="n">${num(r.pay.unemployment)}</td><td class="n">${num(r.pay.medical)}</td><td class="n">${num(r.pay.otherDeductions)}</td><td class="n">${num(r.pay.net)}</td></tr>`).join("")
      + `<tr class="total"><td></td><td class="l" colspan="4">Cəmi</td>${(["salaryPart", "overtimePay", "leavePay"] as const).map((k) => `<td class="n">${num(sum(list, (r) => r.pay[k]))}</td>`).join("")}<td class="n">${num(sum(list, (r) => r.inputs.bonus + r.inputs.otherAdd))}</td>${(["gross", "tax", "dsmf", "unemployment", "medical", "otherDeductions", "net"] as const).map((k) => `<td class="n">${num(sum(list, (r) => r.pay[k]))}</td>`).join("")}</tr>`;
    const firm = data.firms.find((f) => f.id === data.companyId)?.name || "";
    printTable("Hesablama-ödəmə cədvəli", `${firm} · ${periodLabel(data.period)}${approved ? "" : " · təsdiqlənməyib (qaralama)"}`, headRow, body);
  };
  const toolbar = <>
    {dirty > 0 && <span className="hint">{dirty} sətirdə yadda saxlanmamış dəyişiklik var</span>}
    {dirty > 0 && <Button variant="outline" disabled={busy} onClick={() => { setEdits({}); setInputEdits({}); }}><Undo2 />Ləğv et</Button>}
    <Button disabled={busy || !dirty} onClick={() => void save()}><Save />Yadda saxla</Button>
    <Button variant="outline" onClick={() => tab === "payroll" ? printPayroll() : printSheet()}><Printer />Çap et</Button>
  </>;


  // The payroll: an approved month as it was approved; otherwise worked out live from the tabel and the inputs on the page.
  function payrollRows() {
    if (approved && data.payroll.snapshot) return data.payroll.snapshot.map((s) => ({ id: s.hr_employee_id, name: s.name, position: s.position, department: s.department, normDays: s.normDays, workedDays: s.workedDays, overtime: s.overtime, inputs: s.inputs, leavePay: s.leaveDetails || [], pay: s as PayrollRow }));
    return rows.map((r) => {
      const typed = inputEdits[r.emp.id] || {};
      const base = inputsOf(r.emp.id);
      const inputs: PayrollInputs = { ...base, note: typed.note ?? base.note };
      for (const key of PAYROLL_INPUT_KEYS) { const raw = typed[key]; if (raw !== undefined) { const v = Number(String(raw).replace(",", ".")); inputs[key] = Number.isFinite(v) && v >= 0 ? v : 0; } }
      const leavePay = data.leavePay.filter((l) => l.hr_employee_id === r.emp.id);
      const ot = overtimeHours(r.overtime);
      return { id: r.emp.id, name: personName(r.emp), position: r.emp.position, department: r.department, normDays: r.sheet.norm.days, workedDays: r.sheet.workedDays, overtime: ot, inputs, leavePay,
        pay: payrollRow({ salary: r.emp.monthly_salary ?? null, period: data.period, row: r.sheet, overtime: ot, leavePay, inputs }) };
    });
  }

  if (tab === "payroll") {
    const list = payrollRows();
    const open = data.departments.filter((d) => d.status !== "accepted");
    const editable = access.payEdit && !approved;
    const cell = (id: number, key: (typeof PAYROLL_INPUT_KEYS)[number], value: number) => editable
      ? <input className="payinput" inputMode="decimal" value={inputEdits[id]?.[key] ?? (value ? String(value) : "")} onChange={(e) => setInputEdits((c) => ({ ...c, [id]: { ...(c[id] || {}), [key]: e.target.value } }))} />
      : <>{value ? num(value) : "—"}</>;
    return <>
      {approved ? <div className="hrnote">✓ Təsdiqlənib{data.payroll.approved_by ? `: ${data.payroll.approved_by}` : ""}{data.payroll.approved_at ? `, ${formatDay(data.payroll.approved_at)}` : ""}. Hesablanmış məbləğlər işçi kartlarının “Əmək haqqı” bölməsinə yazılıb.</div>
        : open.length > 0 ? <div className="hralert">⚠ Təsdiq üçün bütün şöbələrin tabeli qəbul edilməlidir. Qəbul edilməyib: {open.map((d) => deptName(d.department)).join(", ")}.</div> : null}
      <div className="payrollactions">
        {toolbar}
        {access.payEdit && access.allDepartments && (approved
          ? <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Təsdiq ləğv edilsin? Cədvəl yenidən dəyişdirilə biləcək.")) void send({ action: "unapprove" }); }}>Təsdiqi ləğv et</Button>
          : <Button disabled={busy || dirty > 0 || open.length > 0} onClick={() => { if (window.confirm(`${periodLabel(data.period)} əməkhaqqı cədvəli təsdiqlənsin?`)) void send({ action: "approve" }); }}><Check />Təsdiqlə</Button>)}
      </div>
      <div className="tabelscroll"><table className="paytable">
        <thead><tr><th>№</th><th className="l">İşçi</th><th>Maaş</th><th>Norma / işlənib, gün</th><th>Əməkhaqqı</th><th>Əlavə saat</th><th>Məzuniyyət haqqı</th><th>{INPUT_LABELS.bonus}</th><th>{INPUT_LABELS.otherAdd}</th><th className="strong">Hesablanıb</th><th>Gəlir vergisi</th><th>DSMF</th><th>İşsizlik</th><th>İTS</th><th>{INPUT_LABELS.advance}</th><th>{INPUT_LABELS.alimony}</th><th>{INPUT_LABELS.otherDed}</th><th className="strong">Ödənilməli</th><th>İşəgötürən: DSMF / işsizlik / İTS</th></tr></thead>
        <tbody>{list.map((r, i) => <tr key={r.id}>
          <td>{i + 1}</td><td className="l"><b>{r.name}</b><small>{[deptName(r.department), r.position].filter(Boolean).join(" · ")}</small></td>
          <td className="n">{r.pay.salary ? num(r.pay.salary) : <span className="warn" title="Kartda vəzifə maaşı yoxdur">—</span>}</td>
          <td>{r.normDays} / {r.workedDays}</td><td className="n">{num(r.pay.salaryPart)}</td>
          <td className="n" title={r.overtime ? `${r.overtime} saat × ${num(r.pay.hourly)} × ${OVERTIME_MULTIPLIER}` : ""}>{r.pay.overtimePay ? num(r.pay.overtimePay) : "—"}</td>
          <td className="n" title={r.leavePay.map((l) => `Əmr № ${l.order_no || "—"}: ${l.days} gün × ${num(l.daily)} (orta günlük${l.averageMonths ? `, ${l.averageMonths} ay` : ", tarixçə yoxdur — vəzifə maaşından"})`).join("\n")}>{r.pay.leavePay ? num(r.pay.leavePay) : "—"}</td>
          <td className="n">{cell(r.id, "bonus", r.inputs.bonus)}</td><td className="n">{cell(r.id, "otherAdd", r.inputs.otherAdd)}</td>
          <td className="n strong">{num(r.pay.gross)}</td><td className="n">{num(r.pay.tax)}</td><td className="n">{num(r.pay.dsmf)}</td><td className="n">{num(r.pay.unemployment)}</td><td className="n">{num(r.pay.medical)}</td>
          <td className="n">{cell(r.id, "advance", r.inputs.advance)}</td><td className="n">{cell(r.id, "alimony", r.inputs.alimony)}</td><td className="n">{cell(r.id, "otherDed", r.inputs.otherDed)}</td>
          <td className="n strong">{num(r.pay.net)}</td><td className="n">{num(r.pay.employerDsmf)} / {num(r.pay.employerUnemployment)} / {num(r.pay.employerMedical)}</td>
        </tr>)}</tbody>
        <tfoot><tr><td></td><td className="l">Cəmi ({list.length} işçi)</td><td></td><td></td>
          {(["salaryPart", "overtimePay", "leavePay"] as const).map((k) => <td key={k} className="n">{num(sum(list, (r) => r.pay[k]))}</td>)}
          <td className="n">{num(sum(list, (r) => r.inputs.bonus))}</td><td className="n">{num(sum(list, (r) => r.inputs.otherAdd))}</td>
          {(["gross", "tax", "dsmf", "unemployment", "medical"] as const).map((k) => <td key={k} className="n">{num(sum(list, (r) => r.pay[k]))}</td>)}
          <td className="n">{num(sum(list, (r) => r.inputs.advance))}</td><td className="n">{num(sum(list, (r) => r.inputs.alimony))}</td><td className="n">{num(sum(list, (r) => r.inputs.otherDed))}</td>
          <td className="n">{num(sum(list, (r) => r.pay.net))}</td><td className="n">{money(sum(list, (r) => r.pay.employerCost - r.pay.gross))}</td></tr></tfoot>
      </table></div>
      <p className="hint">Əməkhaqqı = maaş × işlənmiş gün / norma gün. Əlavə saat = saat × (maaş / norma saat) × {OVERTIME_MULTIPLIER}. Məzuniyyət haqqı imzalı məzuniyyət əmrlərindən: bu aya düşən günlər × orta günlük əməkhaqqı (məzuniyyət iki aya düşəndə hər ay öz günlərinin haqqını alır və həmin ayda vergiyə cəlb olunur). Vergi və ayırmalar 2026-cı il özəl qeyri-neft sektoru dərəcələri ilə — ilkin versiya, mühasib yoxlamalıdır.</p>
    </>;
  }

  const overtimeView = tab === "overtime";
  return <>
    {approved && <div className="hrnote">✓ Bu ayın əməkhaqqı cədvəli təsdiqlənib — tabel dəyişdirilmir.</div>}
    {statusBar}
    <div className="payrollactions">{toolbar}</div>
    <div className="tabelscroll"><table className="tabelgrid">
      <thead><tr><th>№</th><th className="l namecol">İşçi</th>{dayHead}{overtimeView ? <th>Cəmi saat</th> : <><th title="İşlənmiş gün">Gün</th><th title="İşlənmiş saat">Saat</th><th title="Norma: gün / saat">Norma</th><th>M</th><th>X</th><th>E</th><th>Q</th><th title="Ödənişsiz, sosial, təhsil məzuniyyəti">Ö/S/T</th></>}</tr></thead>
      <tbody>{groups.map(({ sheet, rows: list }) => <Fragment key={sheet.department}>
        <tr className="deptrow"><td colSpan={days.length + (overtimeView ? 3 : 10)}>{deptName(sheet.department)} <span>{STATUS[sheet.status]}</span></td></tr>
        {list.map((r) => {
          const editable = canEdit(r.department);
          const t = r.sheet.totals;
          return <tr key={r.emp.id}>
            <td>{numberOf.get(r.emp.id)}</td><td className="l namecol"><b>{personName(r.emp)}</b><small>{r.emp.position || ""}</small></td>
            {overtimeView ? days.map((d) => {
              const day = d.slice(8);
              const typed = r.edit?.overtime[day];
              const value = typed ?? (r.overtime[day] ? String(r.overtime[day]) : "");
              const bad = typed !== undefined && normalizeOvertime(typed) === null;
              const out = r.sheet.cells.find((c) => c.date === d)?.value === "—";
              return <td key={d} className={`${out ? "out" : ""}${bad ? " bad" : ""}`}>{editable && !out ? <input value={value} inputMode="decimal" onChange={(e) => setMark(r.emp.id, "overtime", day, e.target.value)} /> : value}</td>;
            }) : r.sheet.cells.map((c) => {
              const day = c.date.slice(8);
              const typed = r.edit?.marks[day];
              const bad = typed !== undefined && normalizeMark(typed) === null;
              const cls = `${c.locked ? "locked" : ""}${c.manual ? " manual" : ""}${bad ? " bad" : ""} code-${c.value === "—" ? "out" : /^\d/.test(c.value) ? "h" : c.value}`;
              const leave = c.locked && c.value !== "—" ? data.leaves.find((l) => l.hr_employee_id === r.emp.id && l.start_date <= c.date && c.date <= l.end_date) : null;
              const title = leave ? `${DAY_CODES.find((x) => x.code === c.value)?.label || ""}${leave.order_no ? `, əmr № ${leave.order_no}` : ""} — dəyişmək olmaz` : c.manual ? `Avtomatik: ${c.auto}` : "";
              return <td key={c.date} className={cls} title={title}>{editable && !c.locked ? <input value={typed ?? c.value} onChange={(e) => setMark(r.emp.id, "marks", day, e.target.value)} onFocus={(e) => e.target.select()} /> : c.value}</td>;
            })}
            {overtimeView ? <td><b>{overtimeHours(r.overtime) || ""}</b></td> : <>
              <td><b>{r.sheet.workedDays}</b></td><td>{r.sheet.workedHours}</td><td className="muted">{r.sheet.norm.days} / {r.sheet.norm.hours}</td>
              <td>{t.M || ""}</td><td>{t.X || ""}</td><td>{t.E || ""}</td><td>{t.Q || ""}</td><td>{t.Ö + t.S + t.T || ""}</td></>}
          </tr>;
        })}
      </Fragment>)}</tbody>
    </table></div>
    <div className="tabellegend">
      {overtimeView ? <span>Hər gün üçün iş vaxtından artıq işlənmiş saatları yazın. Əməkhaqqında saatlıq dərəcənin {OVERTIME_MULTIPLIER} misli ilə hesablanır.</span>
        : <><span><b>Rəqəm</b> — işlənmiş saat</span>{DAY_CODES.map((c) => <span key={c.code}><b>{c.code}</b> — {c.label}</span>)}
          <span className="legendnote">Xanalar istehsalat təqvimi ilə avtomatik dolur. Yalnız fərqləri yazın: saat (məs. 4), E, Q, X və ya İ. Boz xanalar məzuniyyət əmrindən və xəstəlik vərəqəsindən gəlir — dəyişdirilmir. Xananı silsəniz, avtomatik dəyər qayıdır.</span></>}
    </div>
  </>;
}

function sum<T>(list: T[], pick: (item: T) => number) {
  return Math.round(list.reduce((total, item) => total + (Number(pick(item)) || 0), 0) * 100) / 100;
}

