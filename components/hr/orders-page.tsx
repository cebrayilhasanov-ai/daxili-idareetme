"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionsHeader, ColGroup, SortableTh, useColumnDrag, useEdgeResize, useExcelFilters, useTableColumns, type ExcelColumn } from "@/components/table-kit";
import {
  TERMINATION_REASONS, formatDay, indexCalendar, isIsoDate, leaveBalance, normalizeParams, settlement, todayIso,
  type CalendarDay, type HrLeaveCalc, type HrParams, type SalaryRow,
} from "@/lib/hr-calc";
import {
  ORDER_GROUPS, ORDER_LEAVE_KINDS, ORDER_STATUS_LABELS, ORDER_TEMPLATE_TOKENS, fillOrderTemplate, leaveOrderText, money, normalizeLeaveLegal, normalizeTerminationLegal, orderNumber, planLeaveOrder,
  settlementSnapshot, terminationOrderText,
  type LeaveLegal, type OrderEmployee, type OrderGroup, type SettlementSnapshot, type TerminationExtra, type TerminationLegal,
} from "@/lib/hr-orders";
import { docxParagraphs } from "@/lib/docx-text";

// Kadrlar → Əmrlər: leave, termination and other orders are written here (never on the card), printed from the system and take
// effect once their signed copy is uploaded — a leave then goes on the card, a termination fills the card's "İşdən çıxma".
// Other orders take their text from a Kadrlar template's Word file (a template of the worker's firm).

type Order = {
  id: number; company_id: number; company_name: string | null; grp: OrderGroup; year: number; seq: number; order_no: string; order_date: string; hr_employee_id: number;
  last_name: string | null; first_name: string | null; patronymic: string | null; status: "pending" | "signed" | "cancelled"; kind: string | null; start_date: string | null;
  end_date: string | null; days: number | null; basis: string | null; title: string; legal_text: string | null; items: string; extra: string | null; signed_key: string | null; signed_name: string | null;
  signed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; created_by: string | null;
};
type Employee = OrderEmployee & { company_name: string | null; contract_no: string | null; contract_date: string | null };
type OrdersData = {
  orders: Order[]; employees: Employee[]; leaves: (HrLeaveCalc & { hr_employee_id: number; order_id: number | null })[]; calendar: CalendarDay[];
  children: { hr_employee_id: number; relation: string; birth_date: string | null }[]; companies: { id: number; name: string; manager: string | null }[];
  numbering: { company_id: number; grp: string; pattern: string }[]; params: HrParams; legal: LeaveLegal; terminationLegal: TerminationLegal;
  templates: { id: number; company_id: number | null; name: string; template1_key: string | null; template1_name: string | null }[];
  // The viewer's rights in Əmrlər (Versiya 2.62): Sil is cancelling an order.
  rights?: { add: boolean; edit: boolean; delete: boolean };
};
const rightsOf = (data: OrdersData) => data.rights ?? { add: true, edit: true, delete: true };
type Send = (payload: Record<string, unknown>) => Promise<OrdersData & { savedId?: number }>;
type Pay = { monthlySalary: number | null; salaries: SalaryRow[] };

const personName = (o: { last_name: string | null; first_name: string | null; patronymic: string | null }) => [o.last_name, o.first_name, o.patronymic].filter(Boolean).join(" ");
const kindLabel = (key: string | null) => ORDER_LEAVE_KINDS.find((k) => k.key === key)?.label || key || "—";
const reasonLabel = (key: string | null) => TERMINATION_REASONS.find((r) => r.key === key)?.label || key || "—";
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fileUrl = (key: string) => `/api/file?key=${encodeURIComponent(key)}`;
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const periodLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const parseExtra = (raw: string | null): TerminationExtra => { try { const v = JSON.parse(raw || "{}"); return { severance: Boolean(v.severance), workedDays: v.workedDays ?? null, deductOverused: Boolean(v.deductOverused), settlement: v.settlement }; } catch { return { severance: false, workedDays: null, deductOverused: false }; } };

async function loadPay(employeeId: number): Promise<Pay> {
  const response = await fetch(`/api/hr/orders?salaries=${employeeId}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Əmək haqqı məlumatı açılmadı.");
  return body;
}
function computeSettlement(emp: Employee, data: OrdersData, pay: Pay, date: string, reasonKey: string, extra: TerminationExtra) {
  if (!isIsoDate(date) || date < emp.hire_date) return null;
  const leaves = data.leaves.filter((l) => l.hr_employee_id === emp.id);
  const result = settlement({ ...emp, termination_date: null, monthly_salary: pay.monthlySalary }, leaves, pay.salaries, indexCalendar(data.calendar), normalizeParams(data.params),
    { date, reasonKey, severance: extra.severance, workedDays: extra.workedDays, deductOverused: extra.deductOverused });
  return { result, snapshot: settlementSnapshot(result, pay.monthlySalary, extra.severance, extra.deductOverused, date) };
}

export function OrdersPage() {
  const [data, setData] = useState<OrdersData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"leave" | "termination" | "other" | "settings">("leave");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hr/orders").then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!cancelled) setData(body); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Əmrlər açılmadı."); });
    return () => { cancelled = true; };
  }, []);
  const send: Send = async (payload) => {
    const response = await fetch("/api/hr/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Əməliyyat baş tutmadı.");
    setData(body);
    return body;
  };
  if (error) return <section className="panel pagepanel directorypanel"><div className="errorbox">{error}</div></section>;
  if (!data) return <section className="panel pagepanel directorypanel"><div className="loading">Əmrlər yüklənir...</div></section>;
  const unsigned = data.orders.filter((o) => o.status === "pending");
  const count = (grp: OrderGroup) => unsigned.filter((o) => o.grp === grp).length;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Əmrlər</h2><p>Əmrlər sistemdə yazılır, çap olunur, imzalı nüsxəsi yüklənəndə qüvvəyə minir</p></div></div>
    {unsigned.length > 0 && <div className="hralert">⚠ {unsigned.length} əmrin imzalı nüsxəsi hələ yüklənməyib — imzalı nüsxə yüklənməyənə qədər əmr işçinin kartına təsir etmir.</div>}
    <div className="fixedsubtabs hrtabs ordertabs">
      <button className={tab === "leave" ? "on" : ""} onClick={() => setTab("leave")}>Məzuniyyət əmrləri{count("leave") > 0 && <em>{count("leave")}</em>}</button>
      <button className={tab === "termination" ? "on" : ""} onClick={() => setTab("termination")}>İşdən çıxma əmrləri{count("termination") > 0 && <em>{count("termination")}</em>}</button>
      <button className={tab === "other" ? "on" : ""} onClick={() => setTab("other")}>Digər əmrlər{count("other") > 0 && <em>{count("other")}</em>}</button>
      <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Parametrlər</button>
    </div>
    {tab === "leave" ? <LeaveOrders data={data} send={send} /> : tab === "termination" ? <TerminationOrders data={data} send={send} /> : tab === "other" ? <OtherOrders data={data} send={send} /> : <OrderSettings data={data} send={send} />}
  </section>;
}

// ---------------------------------------------------------------- printing
function orderHtml(order: Order, data: OrdersData) {
  const company = data.companies.find((c) => c.id === order.company_id);
  const items: string[] = (() => { try { return JSON.parse(order.items); } catch { return []; } })();
  const h = escapeHtml;
  return `${order.status === "cancelled" ? `<div class="cancel">LƏĞV EDİLİB${order.cancel_reason ? `: ${h(order.cancel_reason)}` : ""}</div>` : ""}
  <div class="firm">${h(company?.name || order.company_name || "")}</div>
  <h1>ƏMR № ${h(order.order_no)}</h1>
  <div class="meta"><span></span><span>${formatDay(order.order_date)}</span></div>
  <h2>${h(order.title)}</h2>
  ${order.legal_text ? `<p>${h(order.legal_text)},</p>` : ""}
  ${order.grp === "other"
    ? items.map((i) => (/^ƏMR\s+EDİRƏM/i.test(i) ? `<p class="center">${h(i)}</p>` : `<p class="para">${h(i)}</p>`)).join("")
    : `<p class="center">ƏMR EDİRƏM:</p><ol>${items.map((i) => `<li>${h(i)}</li>`).join("")}</ol>`}
  ${order.basis ? `<p class="basis"><b>Əsas:</b> ${h(order.basis)}.</p>` : ""}
  <div class="sign"><span><b>Rəhbər</b></span><span>____________________ ${h(company?.manager || "")}</span></div>
  <div class="ack">Əmrlə tanış oldum: ____________________ ${h(personName(order))}&nbsp;&nbsp;&nbsp; «____» ______________ 20____</div>`;
}
function settlementHtml(order: Order, s: SettlementSnapshot, draft: boolean) {
  const h = escapeHtml;
  const rows = s.lines.map((l) => `<tr><td><b>${h(l.label)}</b><br><small>${h(l.detail)}</small></td><td class="n">${h(money(l.amount))}</td></tr>`).join("");
  const avg = s.average.rows.map((r) => `<tr><td>${h(periodLabel(r.period))}</td><td class="n">${r.amount ? h(money(r.amount)) : "—"}</td></tr>`).join("");
  return `<div class="pagebreak"></div><h1 class="small">Son hesablaşma cədvəli</h1>
  <p>Əmr № ${h(order.order_no)}, ${formatDay(order.order_date)} · ${h(personName(order))} · işdən çıxma tarixi ${formatDay(order.start_date)} · əsas: ${h(reasonLabel(order.kind))} · məzuniyyət qalığı ${h(String(Math.round(s.balanceDays * 100) / 100))} gün</p>
  ${draft ? `<p class="draft">Əmr hələ imzalanmayıb — məbləğlər cari məlumatlarla hesablanıb; imzalı nüsxə yüklənəndə dəqiqləşdirilib saxlanılır.</p>` : ""}
  <table class="calc">${rows}<tr class="total"><td>Cəmi hesablanıb</td><td class="n">${h(money(s.total))}</td></tr></table>
  <h2 class="left">Orta əmək haqqı (${s.average.months} ay, cəmi ${h(money(s.average.total))}, orta aylıq ${h(money(s.average.monthly))}, orta günlük ${h(money(s.average.daily))})</h2>
  <table class="calc">${avg}</table>
  <p class="note">Məbləğlər vergi və məcburi sosial sığorta tutulmalarından əvvəl göstərilib.</p>`;
}
function openPrint(title: string, body: string) {
  const w = window.open("", "_blank", "width=820,height=960");
  if (!w) { window.alert("Çap pəncərəsi açılmadı — brauzerdə bu sayt üçün açılan pəncərələrə icazə verin."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font:14px/1.6 "Times New Roman",serif;color:#000;margin:40px 56px}.firm{text-align:center;font-weight:bold;text-transform:uppercase;font-size:15px}
    h1{text-align:center;font-size:18px;margin:26px 0 4px;letter-spacing:.05em}h1.small{font-size:16px;margin-top:0}.meta{display:flex;justify-content:space-between;margin:10px 0 18px}
    h2{text-align:center;font-size:15px;margin:0 0 18px}h2.left{text-align:left;font-size:13px;margin:18px 0 6px}.center{text-align:center;font-weight:bold;margin:16px 0}ol{padding-left:22px}li{margin-bottom:8px;text-align:justify}
    .basis{margin-top:18px}.para{text-align:justify;margin:0 0 8px;white-space:pre-wrap}.sign{margin-top:48px;display:flex;justify-content:space-between}.ack{margin-top:40px}.cancel{border:2px solid #b00;color:#b00;padding:6px 10px;text-align:center;font-weight:bold;margin-bottom:12px}
    .pagebreak{page-break-before:always;height:1px}table.calc{width:100%;border-collapse:collapse;font:12px/1.45 Arial,sans-serif}table.calc td{border:1px solid #bbb;padding:6px 8px;vertical-align:top}.n{text-align:right;white-space:nowrap}
    table.calc small{color:#555}.total td{font-weight:bold}.note,.draft{font:11px Arial,sans-serif;color:#555}.draft{color:#b45309}
    @media print{body{margin:18mm 20mm}}
  </style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
}
async function printOrder(order: Order, data: OrdersData) {
  let body = orderHtml(order, data);
  if (order.grp === "termination") {
    const extra = parseExtra(order.extra);
    let snapshot = extra.settlement || null;
    const emp = data.employees.find((e) => e.id === order.hr_employee_id);
    if (!snapshot && emp && order.start_date) snapshot = computeSettlement(emp, data, await loadPay(emp.id), order.start_date, order.kind || "", extra)?.snapshot || null;
    if (snapshot) body += settlementHtml(order, snapshot, !extra.settlement);
  }
  openPrint(`Əmr № ${order.order_no}`, body);
}

// ---------------------------------------------------------------- register shared by the groups
type OrderColumn = ExcelColumn<Order> & { width: number; render: (o: Order) => React.ReactNode };
const commonColumns = (): OrderColumn[] => [
  { key: "no", label: "Əmr №", width: 90, search: (o) => o.order_no, sort: (o) => `${o.company_id}-${o.year}-${String(o.seq).padStart(6, "0")}`, render: (o) => <b>{o.order_no}</b> },
  { key: "date", label: "Tarix", width: 100, search: (o) => formatDay(o.order_date), sort: (o) => o.order_date, render: (o) => <>{formatDay(o.order_date)}</> },
  { key: "company", label: "Firma", width: 160, search: (o) => o.company_name || "", render: (o) => <>{o.company_name || "—"}</> },
  { key: "employee", label: "İşçi", width: 200, search: (o) => personName(o), render: (o) => <>{personName(o) || "—"}</> },
];
const statusColumns = (): OrderColumn[] => [
  { key: "status", label: "Status", width: 170, search: (o) => ORDER_STATUS_LABELS[o.status] || o.status, render: (o) => <span className={`orderstatus ${o.status}`}>{ORDER_STATUS_LABELS[o.status] || o.status}</span> },
  { key: "signed", label: "İmzalı nüsxə", width: 170, search: (o) => o.signed_name || "Yoxdur", render: (o) => o.signed_key ? <a href={fileUrl(o.signed_key)} target="_blank" rel="noreferrer">{o.signed_name || "Bax"}</a> : <span className="hrsub">Yüklənməyib</span> },
];
const LEAVE_COLUMNS: OrderColumn[] = [...commonColumns(),
  { key: "kind", label: "Növ", width: 170, search: (o) => kindLabel(o.kind), render: (o) => <>{kindLabel(o.kind)}</> },
  { key: "period", label: "Dövr", width: 170, search: (o) => (o.start_date ? `${formatDay(o.start_date)} – ${formatDay(o.end_date)}` : ""), sort: (o) => o.start_date || "", render: (o) => <>{o.start_date ? `${formatDay(o.start_date)} – ${formatDay(o.end_date)}` : "—"}</> },
  { key: "days", label: "Gün", width: 60, search: (o) => String(o.days ?? ""), sort: (o) => Number(o.days || 0), render: (o) => <>{o.days ?? "—"}</> },
  ...statusColumns()];
const OTHER_COLUMNS: OrderColumn[] = [...commonColumns(),
  { key: "title", label: "Əmrin adı", width: 240, search: (o) => o.title, render: (o) => <>{o.title}</> },
  ...statusColumns()];
const TERMINATION_COLUMNS: OrderColumn[] = [...commonColumns(),
  { key: "reason", label: "Əsas", width: 220, search: (o) => reasonLabel(o.kind), render: (o) => <>{reasonLabel(o.kind)}</> },
  { key: "tdate", label: "İşdən çıxma tarixi", width: 130, search: (o) => formatDay(o.start_date), sort: (o) => o.start_date || "", render: (o) => <>{formatDay(o.start_date)}</> },
  ...statusColumns()];

function OrderRegister({ grp, columns, data, send, onEdit, busy, run, setNotice }: {
  grp: OrderGroup; columns: OrderColumn[]; data: OrdersData; send: Send; onEdit: (o: Order) => void; busy: string;
  run: (key: string, work: () => Promise<unknown>) => Promise<boolean>; setNotice: (text: string) => void;
}) {
  const { order, widths, setWidth, moveColumn } = useTableColumns(`hrorders-${grp}`, columns.map((c) => c.key));
  const resize = useEdgeResize(setWidth, 50);
  const { dragProps } = useColumnDrag(moveColumn);
  const columnsByKey = Object.fromEntries(columns.map((c) => [c.key, c]));
  const excel = useExcelFilters(`hrorders-${grp}`, columns, data.orders.filter((o) => o.grp === grp));
  const effect = grp === "leave" ? "məzuniyyət işçinin kartına yazıldı" : grp === "termination" ? "işdən çıxma işçinin kartına yazıldı, son hesablaşma yadda saxlandı" : "əmr qüvvəyə mindi";
  const cancel = (o: Order) => {
    const warn = o.status === "signed" ? (grp === "leave" ? "\nƏmr imzalanıb — onun əsasında qeydə alınmış məzuniyyət də kartdan silinəcək." : "\nƏmr imzalanıb — işçi yenidən “İşləyir” statusuna qaytarılacaq.") : "";
    const reason = window.prompt(`Əmr № ${o.order_no} ləğv edilsin?${warn}\n\nLəğv etmənin səbəbini yazın:`);
    if (reason === null) return;
    void run(`cancel${o.id}`, () => send({ action: "cancel", id: o.id, reason }));
  };
  const upload = (o: Order, file: File | undefined) => {
    if (!file) return;
    void run(`sign${o.id}`, async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error("Faylın həcmi 20 MB-dan çox ola bilməz.");
      const fd = new FormData(); fd.append("file", file);
      const response = await fetch("/api/file", { method: "POST", body: fd });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fayl yüklənmədi.");
      await send({ action: "sign", id: o.id, key: result.key, name: result.name, size: file.size, type: file.type });
      setNotice(o.status === "pending" ? `Əmr № ${o.order_no} imzalandı — ${effect}.` : `Əmr № ${o.order_no}: imzalı nüsxə yeniləndi.`);
    });
  };
  return <div className="tasktablewrap"><table className="tasktable hrtable"><ColGroup order={order} defaultWidths={Object.fromEntries(columns.map((c) => [c.key, c.width]))} widths={widths} extraKeys={["actions"]} />
    <thead><tr>{order.map((key) => <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(columnsByKey[key])}</SortableTh>)}<th {...resize("actions")} className={`opencolumn${resize("actions").className ? ` ${resize("actions").className}` : ""}`}><ActionsHeader /></th></tr></thead>
    <tbody>{excel.rows.map((o) => <tr key={o.id} className={o.status === "cancelled" ? "ordercancelled" : o.status === "pending" ? "orderpending" : ""}>
      {order.map((key) => <td key={key} data-label={columnsByKey[key].label}>{columnsByKey[key].render(o)}</td>)}
      <td data-label="Əməliyyat"><div className="tableactions">
        <button className="editcompanybtn" disabled={busy === `print${o.id}`} onClick={() => void run(`print${o.id}`, () => printOrder(o, data))}><Printer />{grp === "termination" ? "Əmr və hesablaşma" : "Çap et"}</button>
        {o.status !== "cancelled" && rightsOf(data).edit && <label className={`editcompanybtn orderupload${o.status === "pending" ? " need" : ""}`}>{busy === `sign${o.id}` ? "Yüklənir..." : <><Upload />{o.signed_key ? "Nüsxəni dəyiş" : "İmzalı nüsxəni yüklə"}</>}<input type="file" accept="image/*,application/pdf" disabled={Boolean(busy)} onChange={(e) => { upload(o, e.target.files?.[0]); e.target.value = ""; }} /></label>}
        {o.status === "pending" && rightsOf(data).edit && <button className="editcompanybtn" onClick={() => onEdit(o)}>Düzəlt</button>}
        {o.status !== "cancelled" && rightsOf(data).delete && <button className="deletetaskbtn" disabled={Boolean(busy)} onClick={() => cancel(o)}>Ləğv et</button>}
        {o.status === "cancelled" && o.cancel_reason && <small className="hrsub" title={o.cancel_reason}>Səbəb: {o.cancel_reason}</small>}
      </div></td>
    </tr>)}</tbody></table>
    {!excel.rows.length && <div className="empty"><p>{data.orders.some((o) => o.grp === grp) ? "Filtrə uyğun əmr tapılmadı." : grp === "leave" ? "Hələ məzuniyyət əmri yoxdur. “Yeni məzuniyyət əmri” düyməsi ilə başlayın." : grp === "termination" ? "Hələ işdən çıxma əmri yoxdur. “Yeni işdən çıxma əmri” düyməsi ilə başlayın." : "Hələ digər əmr yoxdur. “Yeni əmr” düyməsi ilə başlayın."}</p></div>}
  </div>;
}

function useRunner() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError(""); setNotice("");
    try { await work(); return true; } catch (e) { setError(e instanceof Error ? e.message : "Əməliyyat baş tutmadı."); return false; } finally { setBusy(""); }
  };
  return { busy, error, notice, setError, setNotice, run };
}
const nextNumber = (data: OrdersData, grp: OrderGroup, companyId: number | null, orderDate: string) => {
  if (!companyId || !isIsoDate(orderDate)) return "";
  const pattern = data.numbering.find((n) => n.company_id === companyId && n.grp === grp)?.pattern || ORDER_GROUPS.find((g) => g.key === grp)?.defaultPattern || "{No}";
  return orderNumber(pattern, Math.max(0, ...data.orders.filter((o) => o.company_id === companyId && o.grp === grp && o.year === Number(orderDate.slice(0, 4))).map((o) => o.seq)) + 1, orderDate);
};

// ---------------------------------------------------------------- leave orders
const emptyLeaveForm = (): Record<string, string> => ({ id: "", companyId: "", hrEmployeeId: "", kind: "annual", startDate: "", endDate: "", orderDate: todayIso(), basis: "İşçinin ərizəsi" });
function LeaveOrders({ data, send }: { data: OrdersData; send: Send }) {
  const [form, setForm] = useState(emptyLeaveForm);
  const [open, setOpen] = useState(false);
  const { busy, error, notice, setError, setNotice, run } = useRunner();
  const params = useMemo(() => normalizeParams(data.params), [data.params]);
  const legal = useMemo(() => normalizeLeaveLegal(data.legal), [data.legal]);
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const employees = data.employees.filter((e) => !e.termination_date && (!form.companyId || String(e.company_id) === form.companyId));
  const emp = data.employees.find((e) => String(e.id) === form.hrEmployeeId) || null;
  const leaves = emp ? data.leaves.filter((l) => l.hr_employee_id === emp.id && l.order_id !== Number(form.id || 0)) : [];
  const childrenUnder14 = emp && form.startDate ? data.children.filter((c) => {
    if (c.hr_employee_id !== emp.id || !c.birth_date) return false;
    let age = Number(form.startDate.slice(0, 4)) - Number(c.birth_date.slice(0, 4));
    if (form.startDate.slice(5) < c.birth_date.slice(5)) age -= 1;
    return age < 14;
  }).length : 0;
  const input = { kind: form.kind, startDate: form.startDate, endDate: form.endDate, basis: form.basis };
  const plan = emp ? planLeaveOrder(emp, input, { leaves, calendar: data.calendar, params, legal, childrenUnder14 }) : null;
  const body = emp && plan && plan.days ? leaveOrderText(emp, input, plan) : null;
  const balance = emp && isIsoDate(form.startDate) ? leaveBalance(emp, leaves, params, form.startDate) : null;
  const nextNo = !form.id && emp ? nextNumber(data, "leave", emp.company_id, form.orderDate) : "";
  const save = async () => {
    let result: (OrdersData & { savedId?: number }) | null = null;
    const isNew = !form.id;
    if (!(await run("save", async () => { result = await send({ action: "leave", ...form }); }))) return;
    const done = result as unknown as OrdersData & { savedId?: number };
    const saved = done.orders.find((o) => o.id === done.savedId);
    setForm(emptyLeaveForm()); setOpen(false);
    setNotice(saved ? `Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. Çap edib imzaladıqdan sonra imzalı nüsxəni yükləyin.` : "Əmr yadda saxlandı.");
    if (saved && window.confirm(`Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. İndi çap edilsin?`)) void printOrder(saved, done);
  };
  const edit = (o: Order) => {
    const e = data.employees.find((x) => x.id === o.hr_employee_id);
    setForm({ id: String(o.id), companyId: String(e?.company_id || ""), hrEmployeeId: String(o.hr_employee_id), kind: o.kind || "annual", startDate: o.start_date || "", endDate: o.end_date || "", orderDate: o.order_date, basis: o.basis || "" });
    setOpen(true); setError(""); setNotice("");
  };
  return <div className="ordersbody">
    {!open && rightsOf(data).add && <div className="hractions left"><Button onClick={() => { setForm(emptyLeaveForm()); setOpen(true); setError(""); setNotice(""); }}><Plus />Yeni məzuniyyət əmri</Button></div>}
    {notice && <div className="hrok">{notice}</div>}
    {error && <div className="errorbox">{error}</div>}
    {open && <div className="orderform">
      <h4>{form.id ? "Məzuniyyət əmrini düzəlt" : "Yeni məzuniyyət əmri"}{nextNo && <small> · nömrəsi: № {nextNo}</small>}</h4>
      <div className="hrgrid">
        <label className="field">Firma<select value={form.companyId} disabled={Boolean(form.id)} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, hrEmployeeId: "" }))}><option value="">Bütün firmalar</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field hrwide">İşçi *<select value={form.hrEmployeeId} disabled={Boolean(form.id)} onChange={set("hrEmployeeId")}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{personName(e)}{e.position ? ` — ${e.position}` : ""}{e.company_name ? `, ${e.company_name}` : ""}</option>)}</select></label>
        <label className="field">Məzuniyyətin növü *<select value={form.kind} onChange={set("kind")}>{ORDER_LEAVE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
        <label className="field">Başlama tarixi *<Input type="date" value={form.startDate} onChange={set("startDate")} /></label>
        <label className="field">Bitmə tarixi (son gün) *<Input type="date" value={form.endDate} onChange={set("endDate")} /></label>
        <label className="field">Əmrin tarixi *<Input type="date" value={form.orderDate} onChange={set("orderDate")} /></label>
        <label className="field hrwide">Əsas<Input value={form.basis} placeholder="məs. İşçinin 25.09.2026-cı il tarixli ərizəsi" onChange={set("basis")} /></label>
      </div>
      {emp && plan && <div className="orderplan">
        <div className="orderfacts">
          <span><small>Gün sayı</small><b>{plan.days || "—"}</b></span>
          {plan.returnDate && <span><small>İşə çıxma</small><b>{formatDay(plan.returnDate)}</b></span>}
          {plan.workYear && <span><small>İş ili</small><b>{formatDay(plan.workYear.start)} – {formatDay(plan.workYear.end)}</b></span>}
          {form.kind === "annual" && plan.entitlement > 0 && <span><small>İllik hüquq</small><b>{plan.entitlement} gün</b></span>}
          {balance && form.kind === "annual" && <span><small>Qalıq ({formatDay(form.startDate)})</small><b className={balance.balance < plan.days ? "hrneg" : "hrpos"}>{Math.round(balance.balance * 100) / 100} gün</b></span>}
        </div>
        {plan.legalText && <p className="orderlegal"><b>Hüquqi əsas:</b> {plan.legalText}</p>}
        {plan.warnings.map((w) => <small key={w} className="hrhint hrwarn">⚠ {w}</small>)}
        {body && <div className="orderpreview"><b>{body.title}</b><ol>{body.items.map((i) => <li key={i}>{i}</li>)}</ol></div>}
      </div>}
      <div className="hractions"><button className="inlinecancel" disabled={Boolean(busy)} onClick={() => { setOpen(false); setForm(emptyLeaveForm()); }}>Ləğv et</button><Button disabled={Boolean(busy) || !form.hrEmployeeId || !form.startDate || !form.endDate || !plan?.days} onClick={() => void save()}>{busy === "save" ? "Saxlanılır..." : form.id ? "Dəyişiklikləri saxla" : "Əmri qeydə al"}</Button></div>
    </div>}
    <OrderRegister grp="leave" columns={LEAVE_COLUMNS} data={data} send={send} onEdit={edit} busy={busy} run={run} setNotice={setNotice} />
  </div>;
}

// ---------------------------------------------------------------- termination orders
const emptyTerminationForm = (): Record<string, string> => ({ id: "", companyId: "", hrEmployeeId: "", terminationDate: "", reasonKey: "own", severance: "", workedDays: "", deductOverused: "", orderDate: todayIso(), basis: "İşçinin ərizəsi" });
function TerminationOrders({ data, send }: { data: OrdersData; send: Send }) {
  const [form, setForm] = useState(emptyTerminationForm);
  const [open, setOpen] = useState(false);
  const [pay, setPay] = useState<{ id: number; pay: Pay } | null>(null);
  const { busy, error, notice, setError, setNotice, run } = useRunner();
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const editing = form.id ? data.orders.find((o) => String(o.id) === form.id) : null;
  const employees = data.employees.filter((e) => (!e.termination_date || e.id === editing?.hr_employee_id) && (!form.companyId || String(e.company_id) === form.companyId));
  const emp = data.employees.find((e) => String(e.id) === form.hrEmployeeId) || null;
  // The chosen worker's salaries are fetched once per worker; the settlement then updates as the form changes.
  useEffect(() => {
    if (!emp || pay?.id === emp.id) return;
    let cancelled = false;
    void loadPay(emp.id).then((p) => { if (!cancelled) setPay({ id: emp.id, pay: p }); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Əmək haqqı məlumatı açılmadı."); });
    return () => { cancelled = true; };
  }, [emp, pay?.id, setError]);
  const extra: TerminationExtra = { severance: form.severance === "1", workedDays: form.workedDays.trim() === "" ? null : Number(form.workedDays), deductOverused: form.deductOverused === "1" };
  const calc = emp && pay?.id === emp.id ? computeSettlement(emp, data, pay.pay, form.terminationDate, form.reasonKey, extra) : null;
  const legal = normalizeTerminationLegal(data.terminationLegal)[form.reasonKey] || "";
  const body = emp && calc ? terminationOrderText(emp, { date: form.terminationDate, reasonKey: form.reasonKey, basis: form.basis, severance: extra.severance, contractNo: emp.contract_no, contractDate: emp.contract_date }, calc.result) : null;
  const nextNo = !form.id && emp ? nextNumber(data, "termination", emp.company_id, form.orderDate) : "";
  const pickReason = (key: string) => setForm((f) => ({ ...f, reasonKey: key, severance: TERMINATION_REASONS.find((r) => r.key === key)?.severance ? "1" : "", basis: key === "own" ? f.basis || "İşçinin ərizəsi" : f.basis === "İşçinin ərizəsi" ? "" : f.basis }));
  const save = async () => {
    let result: (OrdersData & { savedId?: number }) | null = null;
    const isNew = !form.id;
    const payload = { action: "termination", ...form, severance: form.severance === "1", deductOverused: form.deductOverused === "1" };
    if (!(await run("save", async () => { result = await send(payload); }))) return;
    const done = result as unknown as OrdersData & { savedId?: number };
    const saved = done.orders.find((o) => o.id === done.savedId);
    setForm(emptyTerminationForm()); setOpen(false);
    setNotice(saved ? `Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. İmzalı nüsxə yüklənəndə işdən çıxma karta yazılacaq.` : "Əmr yadda saxlandı.");
    if (saved && window.confirm(`Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. Əmr və son hesablaşma indi çap edilsin?`)) void run("print", () => printOrder(saved, done));
  };
  const edit = (o: Order) => {
    const e = data.employees.find((x) => x.id === o.hr_employee_id);
    const x = parseExtra(o.extra);
    setForm({ id: String(o.id), companyId: String(e?.company_id || ""), hrEmployeeId: String(o.hr_employee_id), terminationDate: o.start_date || "", reasonKey: o.kind || "own", severance: x.severance ? "1" : "", workedDays: x.workedDays === null ? "" : String(x.workedDays), deductOverused: x.deductOverused ? "1" : "", orderDate: o.order_date, basis: o.basis || "" });
    setOpen(true); setError(""); setNotice("");
  };
  return <div className="ordersbody">
    {!open && rightsOf(data).add && <div className="hractions left"><Button onClick={() => { setForm(emptyTerminationForm()); setOpen(true); setError(""); setNotice(""); }}><Plus />Yeni işdən çıxma əmri</Button></div>}
    {notice && <div className="hrok">{notice}</div>}
    {error && <div className="errorbox">{error}</div>}
    {open && <div className="orderform">
      <h4>{form.id ? "İşdən çıxma əmrini düzəlt" : "Yeni işdən çıxma əmri"}{nextNo && <small> · nömrəsi: № {nextNo}</small>}</h4>
      <div className="hrgrid">
        <label className="field">Firma<select value={form.companyId} disabled={Boolean(form.id)} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, hrEmployeeId: "" }))}><option value="">Bütün firmalar</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field hrwide">İşçi *<select value={form.hrEmployeeId} disabled={Boolean(form.id)} onChange={set("hrEmployeeId")}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{personName(e)}{e.position ? ` — ${e.position}` : ""}{e.company_name ? `, ${e.company_name}` : ""}</option>)}</select></label>
        <label className="field">İşdən çıxma tarixi (son iş günü) *<Input type="date" value={form.terminationDate} onChange={set("terminationDate")} /></label>
        <label className="field hrwide">İşdən çıxma əsası *<select value={form.reasonKey} onChange={(e) => pickReason(e.target.value)}>{TERMINATION_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="field">Son ayda işlənmiş gün<Input inputMode="numeric" value={form.workedDays} placeholder={calc ? `${calc.result.workedDays} (təqvimə görə)` : "təqvimə görə"} onChange={(e) => setForm((f) => ({ ...f, workedDays: e.target.value.replace(/[^\d]/g, "") }))} /></label>
        <label className="field">Əmrin tarixi *<Input type="date" value={form.orderDate} onChange={set("orderDate")} /></label>
        <label className="field hrwide">Əsas<Input value={form.basis} placeholder="məs. İşçinin 25.09.2026-cı il tarixli ərizəsi" onChange={set("basis")} /></label>
        <label className="hrcheck"><input type="checkbox" checked={form.severance === "1"} onChange={(e) => setForm((f) => ({ ...f, severance: e.target.checked ? "1" : "" }))} />İşdən çıxma müavinəti ödənilsin</label>
        {calc && calc.result.overusedDays > 0 && <label className="hrcheck"><input type="checkbox" checked={form.deductOverused === "1"} onChange={(e) => setForm((f) => ({ ...f, deductOverused: e.target.checked ? "1" : "" }))} />Artıq istifadə olunmuş məzuniyyətə görə tutulsun</label>}
      </div>
      {emp && <div className="orderplan">
        {!calc ? <small className="hrhint">{pay?.id === emp.id ? "İşdən çıxma tarixini daxil edin." : "Əmək haqqı məlumatı yüklənir..."}</small> : <>
          <div className="orderfacts">
            <span><small>Məzuniyyət qalığı</small><b className={calc.result.balance.balance < 0 ? "hrneg" : "hrpos"}>{Math.round(calc.result.balance.balance * 100) / 100} gün</b></span>
            {calc.snapshot.lines.map((l) => <span key={l.label}><small>{l.label}</small><b>{money(l.amount)}</b></span>)}
            <span className="ordertotal"><small>Cəmi hesablanıb</small><b>{money(calc.snapshot.total)}</b></span>
          </div>
          {!calc.result.average.months && <small className="hrhint hrwarn">⚠ Son aylar üzrə əmək haqqı qeyd olunmayıb — orta əmək haqqı 0 çıxır (kompensasiya və müavinət hesablanmır). “Personallar → Əmək haqqı” tabında aylıq məbləğləri daxil edin.</small>}
          {legal ? <p className="orderlegal"><b>Hüquqi əsas:</b> {legal}</p> : <small className="hrhint hrwarn">⚠ Bu əsas üçün hüquqi əsasın mətni Parametrlərdə yazılmayıb.</small>}
          {body && <div className="orderpreview"><b>{body.title}</b><ol>{body.items.map((i) => <li key={i}>{i}</li>)}</ol></div>}
        </>}
      </div>}
      <div className="hractions"><button className="inlinecancel" disabled={Boolean(busy)} onClick={() => { setOpen(false); setForm(emptyTerminationForm()); }}>Ləğv et</button><Button disabled={Boolean(busy) || !form.hrEmployeeId || !form.terminationDate || !calc} onClick={() => void save()}>{busy === "save" ? "Saxlanılır..." : form.id ? "Dəyişiklikləri saxla" : "Əmri qeydə al"}</Button></div>
    </div>}
    <OrderRegister grp="termination" columns={TERMINATION_COLUMNS} data={data} send={send} onEdit={edit} busy={busy} run={run} setNotice={setNotice} />
  </div>;
}

// ---------------------------------------------------------------- other orders
const emptyOtherForm = (): Record<string, string> => ({ id: "", companyId: "", hrEmployeeId: "", templateId: "", title: "", body: "", orderDate: todayIso(), basis: "" });
function OtherOrders({ data, send }: { data: OrdersData; send: Send }) {
  const [form, setForm] = useState(emptyOtherForm);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const { busy, error, notice, setError, setNotice, run } = useRunner();
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const employees = data.employees.filter((e) => !e.termination_date && (!form.companyId || String(e.company_id) === form.companyId));
  const emp = data.employees.find((e) => String(e.id) === form.hrEmployeeId) || null;
  const nextNo = !form.id && emp ? nextNumber(data, "other", emp.company_id, form.orderDate) : "";
  // Only the templates of the worker's firm (Şablonlar → firm → Kadrlar).
  const firmTemplates = emp ? data.templates.filter((t) => Number(t.company_id) === Number(emp.company_id)) : [];
  // Reads the template's Word file and fills its placeholders from the chosen worker's card.
  const readTemplate = (templateId: string) => {
    const template = firmTemplates.find((t) => String(t.id) === templateId);
    if (!template) return;
    if (form.body.trim() && !window.confirm("Mətn şablondan yenidən oxunsun? Yazdığınız dəyişikliklər itəcək.")) return;
    void run("template", async () => {
      if (!template.template1_key) throw new Error(`“${template.name}” şablonuna fayl yüklənməyib (Şablonlar → Sənədin şablonu 1).`);
      const response = await fetch(`/api/file?key=${encodeURIComponent(template.template1_key)}`);
      if (!response.ok) throw new Error("Şablon faylı açılmadı.");
      const paragraphs = await docxParagraphs(await response.arrayBuffer());
      // The order name is printed as its own heading, so a template that starts with it does not repeat it in the body.
      const first = paragraphs.findIndex((line) => line.trim());
      if (first >= 0 && paragraphs[first].trim().toLocaleLowerCase("az") === template.name.trim().toLocaleLowerCase("az")) paragraphs.splice(0, first + 1);
      const company = data.companies.find((c) => c.id === emp?.company_id);
      const values: Record<string, string> = emp ? {
        TamAd: personName(emp), Soyad: emp.last_name, Ad: emp.first_name, AtaAdı: emp.patronymic || "", Vəzifə: emp.position || "", Şöbə: emp.department || "",
        Firma: company?.name || emp.company_name || "", İşəQəbulTarixi: formatDay(emp.hire_date), ƏmrTarixi: formatDay(form.orderDate), Rəhbər: company?.manager || "",
      } : {};
      const filled = fillOrderTemplate(paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim(), values);
      setMissing(filled.missing);
      setForm((f) => ({ ...f, templateId, title: f.title && f.templateId === templateId ? f.title : template.name, body: filled.text }));
    });
  };
  const save = async () => {
    let result: (OrdersData & { savedId?: number }) | null = null;
    const isNew = !form.id;
    if (!(await run("save", async () => { result = await send({ action: "other", ...form }); }))) return;
    const done = result as unknown as OrdersData & { savedId?: number };
    const saved = done.orders.find((o) => o.id === done.savedId);
    setForm(emptyOtherForm()); setOpen(false); setMissing([]);
    setNotice(saved ? `Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. Çap edib imzaladıqdan sonra imzalı nüsxəni yükləyin.` : "Əmr yadda saxlandı.");
    if (saved && window.confirm(`Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. İndi çap edilsin?`)) void printOrder(saved, done);
  };
  const edit = (o: Order) => {
    const e = data.employees.find((x) => x.id === o.hr_employee_id);
    const items: string[] = (() => { try { return JSON.parse(o.items); } catch { return []; } })();
    setForm({ id: String(o.id), companyId: String(e?.company_id || ""), hrEmployeeId: String(o.hr_employee_id), templateId: o.kind || "", title: o.title, body: items.join("\n"), orderDate: o.order_date, basis: o.basis || "" });
    setMissing([]); setOpen(true); setError(""); setNotice("");
  };
  return <div className="ordersbody">
    {!open && rightsOf(data).add && <div className="hractions left"><Button onClick={() => { setForm(emptyOtherForm()); setMissing([]); setOpen(true); setError(""); setNotice(""); }}><Plus />Yeni əmr</Button></div>}
    {notice && <div className="hrok">{notice}</div>}
    {error && <div className="errorbox">{error}</div>}
    {open && <div className="orderform">
      <h4>{form.id ? "Əmri düzəlt" : "Yeni əmr"}{nextNo && <small> · nömrəsi: № {nextNo}</small>}</h4>
      {emp && !firmTemplates.length && <small className="hrhint hrwarn">⚠ {emp.company_name || "İşçinin firması"} üçün “Kadrlar” qrupunda şablon yoxdur. Sənədlər → Şablonlar bölməsində firmanı və “Kadrlar” qrupunu seçib şablon əlavə edin, Word (.docx) faylını “Sənədin şablonu 1” kimi yükləyin. Şablonsuz da mətni əl ilə yaza bilərsiniz.</small>}
      <div className="hrgrid">
        <label className="field">Firma<select value={form.companyId} disabled={Boolean(form.id)} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, hrEmployeeId: "" }))}><option value="">Bütün firmalar</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field hrwide">İşçi *<select value={form.hrEmployeeId} disabled={Boolean(form.id)} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, hrEmployeeId: v, templateId: "" })); }}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{personName(e)}{e.position ? ` — ${e.position}` : ""}{e.company_name ? `, ${e.company_name}` : ""}</option>)}</select></label>
        <label className="field hrwide">Şablon<span className="ordertemplatepick"><select value={form.templateId} disabled={!emp || Boolean(busy)} onChange={(e) => { const v = e.target.value; if (v) readTemplate(v); else setForm((f) => ({ ...f, templateId: "" })); }}><option value="">{emp ? "— şablon seçin —" : "əvvəlcə işçini seçin"}</option>{firmTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>{form.templateId && <button type="button" className="hrlink hrlinkok" disabled={Boolean(busy)} onClick={() => readTemplate(form.templateId)}>yenidən oxu</button>}</span></label>
        <label className="field hrwide">Əmrin adı *<Input value={form.title} placeholder="məs. Mükafatlandırma haqqında" onChange={set("title")} /></label>
        <label className="field">Əmrin tarixi *<Input type="date" value={form.orderDate} onChange={set("orderDate")} /></label>
        <label className="field hrwide">Əsas<Input value={form.basis} placeholder="məs. Şöbə müdirinin təqdimatı" onChange={set("basis")} /></label>
      </div>
      {busy === "template" && <small className="hrhint">Şablon oxunur...</small>}
      {missing.length > 0 && <small className="hrhint hrwarn">⚠ Şablonda tanınmayan yer tutucular qaldı: {missing.map((m) => `{${m}}`).join(", ")} — mətndə əl ilə düzəldin. Tanınanlar: {ORDER_TEMPLATE_TOKENS.map((t) => `{${t}}`).join(" ")}</small>}
      <label className="field orderbody">Əmrin mətni * <small>hər sətir çapda ayrıca paraqraf olur; firmanın adı, “ƏMR №”, tarix, imza və tanışlıq sətri avtomatik əlavə olunur</small><textarea value={form.body} rows={12} onChange={set("body")} /></label>
      <div className="hractions"><button className="inlinecancel" disabled={Boolean(busy)} onClick={() => { setOpen(false); setForm(emptyOtherForm()); setMissing([]); }}>Ləğv et</button><Button disabled={Boolean(busy) || !form.hrEmployeeId || !form.title.trim() || !form.body.trim()} onClick={() => void save()}>{busy === "save" ? "Saxlanılır..." : form.id ? "Dəyişiklikləri saxla" : "Əmri qeydə al"}</Button></div>
    </div>}
    <OrderRegister grp="other" columns={OTHER_COLUMNS} data={data} send={send} onEdit={edit} busy={busy} run={run} setNotice={setNotice} />
  </div>;
}

// ---------------------------------------------------------------- settings: number patterns per firm and the Labour Code bases
const LEGAL_FIELDS: { key: keyof LeaveLegal; label: string; hint: string }[] = [
  { key: "annual", label: "Əmək məzuniyyəti — əsas maddələr", hint: "məzuniyyətin növləri, əmək məzuniyyəti, əsas məzuniyyətin müddəti" },
  { key: "stage", label: "Staja görə əlavə məzuniyyət", hint: "işçinin stajı 5 ildən çox olanda əlavə olunur" },
  { key: "women", label: "Uşaqlı qadınlara əlavə məzuniyyət", hint: "qadın işçinin 14 yaşadək 2 və daha çox uşağı olanda" },
  { key: "conditions", label: "Əmək şəraitinə görə əlavə məzuniyyət", hint: "hələlik avtomatik əlavə olunmur" },
  { key: "parts", label: "Məzuniyyətin hissələrə bölünməsi", hint: "illik hüquqdan az gün veriləndə" },
  { key: "unpaid", label: "Ödənişsiz məzuniyyət", hint: "" },
  { key: "social", label: "Sosial məzuniyyət", hint: "" },
  { key: "study", label: "Təhsil məzuniyyəti", hint: "" },
  { key: "other", label: "Digər məzuniyyət", hint: "" },
];
function OrderSettings({ data, send }: { data: OrdersData; send: Send }) {
  const [patterns, setPatterns] = useState<Record<string, string>>(() => Object.fromEntries(data.numbering.map((n) => [`${n.company_id}:${n.grp}`, n.pattern])));
  const [legal, setLegal] = useState<LeaveLegal>(() => normalizeLeaveLegal(data.legal));
  const [terminationLegal, setTerminationLegal] = useState<TerminationLegal>(() => normalizeTerminationLegal(data.terminationLegal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const today = todayIso();
  const save = async () => {
    setBusy(true); setError(""); setSaved("");
    try {
      const numbering = data.companies.flatMap((c) => ORDER_GROUPS.map((g) => ({ companyId: c.id, grp: g.key, pattern: patterns[`${c.id}:${g.key}`] || "" })));
      await send({ action: "settings", numbering, legal, terminationLegal });
      setSaved("Parametrlər yadda saxlandı.");
    } catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); } finally { setBusy(false); }
  };
  return <div className="hrcard hrpad">
    <fieldset><legend>Əmr nömrələri (hər firma üçün ayrıca)</legend>
      <small className="hrhint">Nömrə hər firma və hər qrup üzrə ayrıca, hər il 1-dən başlayır. Şablonda <b>{"{No}"}</b> sıra nömrəsidir (məcburi), <b>{"{İl}"}</b> — il, <b>{"{Ay}"}</b> — ay. Boş saxlanılan xana standart şablonla işləyir.</small>
      <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Firma</th>{ORDER_GROUPS.map((g) => <th key={g.key}>{g.label}</th>)}</tr></thead><tbody>
        {data.companies.map((c) => <tr key={c.id}><td><b>{c.name}</b></td>{ORDER_GROUPS.map((g) => { const k = `${c.id}:${g.key}`; const value = patterns[k] || ""; return <td key={g.key}><Input value={value} placeholder={g.defaultPattern} onChange={(e) => setPatterns((p) => ({ ...p, [k]: e.target.value }))} /><small className="hrsub">nümunə: № {orderNumber(value || g.defaultPattern, 7, today)}</small></td>; })}</tr>)}
      </tbody></table></div>
    </fieldset>
    <fieldset><legend>Məzuniyyət əmrlərində Əmək Məcəlləsinin maddələri</legend>
      <small className="hrhint hrwarn">Maddə nömrələri standart olaraq doldurulub, amma qüvvədə olan redaksiya ilə hüquqşünas və ya mühasib tərəfindən yoxlanmalıdır. Bir neçə maddəni vergüllə yazın (məs. <b>112, 113, 114</b>); sistem “... və 114-cü maddələrinə əsasən” ifadəsini özü qurur.</small>
      <div className="hrgrid">{LEGAL_FIELDS.map((f) => <label key={f.key} className="field">{f.label}{f.hint && <small>{f.hint}</small>}<Input value={legal[f.key]} onChange={(e) => setLegal((l) => ({ ...l, [f.key]: e.target.value }))} /></label>)}</div>
    </fieldset>
    <fieldset><legend>İşdən çıxma əmrlərində hüquqi əsas (hər əsas üçün tam mətn)</legend>
      <small className="hrhint hrwarn">Əmək Məcəlləsinə edilmiş son dəyişikliklərlə xitam əsasları əsasən 68-ci maddədə cəmlənib; standart mətnlər ümumidir. Hüquqşünas hər əsas üçün dəqiq maddə, hissə və bəndi yazmalıdır (məs. “... 68-ci maddəsinin 1-ci hissəsinin «a» bəndinə əsasən”). Mətn əmrdə olduğu kimi, sonuna vergül qoyularaq çap olunur.</small>
      <div className="orderlegalgrid">{TERMINATION_REASONS.map((r) => <label key={r.key} className="field">{r.label}<Input value={terminationLegal[r.key] || ""} onChange={(e) => setTerminationLegal((l) => ({ ...l, [r.key]: e.target.value }))} /></label>)}</div>
    </fieldset>
    {error && <div className="errorbox">{error}</div>}
    {saved && <div className="hrok">{saved}</div>}
    {rightsOf(data).edit && <div className="hractions"><Button disabled={busy} onClick={() => void save()}>{busy ? "Saxlanılır..." : "Yadda saxla"}</Button></div>}
  </div>;
}
