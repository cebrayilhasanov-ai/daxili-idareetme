"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionsHeader, ColGroup, SortableTh, useColumnDrag, useEdgeResize, useExcelFilters, useTableColumns, type ExcelColumn } from "@/components/table-kit";
import { formatDay, leaveBalance, normalizeParams, todayIso, type CalendarDay, type HrLeaveCalc, type HrParams } from "@/lib/hr-calc";
import {
  ORDER_GROUPS, ORDER_LEAVE_KINDS, ORDER_STATUS_LABELS, leaveOrderText, normalizeLeaveLegal, orderNumber, planLeaveOrder,
  type LeaveLegal, type OrderEmployee, type OrderGroup,
} from "@/lib/hr-orders";

// HR → Əmrlər: leave orders are written here (never on the card), printed from the system and count once their signed copy is uploaded.

type Order = {
  id: number; company_id: number; company_name: string | null; grp: OrderGroup; year: number; seq: number; order_no: string; order_date: string; hr_employee_id: number;
  last_name: string | null; first_name: string | null; patronymic: string | null; status: "pending" | "signed" | "cancelled"; kind: string | null; start_date: string | null;
  end_date: string | null; days: number | null; basis: string | null; title: string; legal_text: string | null; items: string; signed_key: string | null; signed_name: string | null;
  signed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; created_by: string | null;
};
type Employee = OrderEmployee & { company_name: string | null };
type OrdersData = {
  orders: Order[]; employees: Employee[]; leaves: (HrLeaveCalc & { hr_employee_id: number; order_id: number | null })[]; calendar: CalendarDay[];
  children: { hr_employee_id: number; relation: string; birth_date: string | null }[]; companies: { id: number; name: string; manager: string | null }[];
  numbering: { company_id: number; grp: string; pattern: string }[]; params: HrParams; legal: LeaveLegal;
};
type Send = (payload: Record<string, unknown>) => Promise<OrdersData & { savedId?: number }>;

const personName = (o: { last_name: string | null; first_name: string | null; patronymic: string | null }) => [o.last_name, o.first_name, o.patronymic].filter(Boolean).join(" ");
const kindLabel = (key: string | null) => ORDER_LEAVE_KINDS.find((k) => k.key === key)?.label || key || "—";
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fileUrl = (key: string) => `/api/file?key=${encodeURIComponent(key)}`;

export function OrdersPage() {
  const [data, setData] = useState<OrdersData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"leave" | "settings">("leave");
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
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Əmrlər</h2><p>Əmrlər sistemdə yazılır, çap olunur, imzalı nüsxəsi yüklənəndə qüvvəyə minir</p></div></div>
    {unsigned.length > 0 && <div className="hralert">⚠ {unsigned.length} əmrin imzalı nüsxəsi hələ yüklənməyib — imzalı nüsxə yüklənməyənə qədər əmr işçinin kartına təsir etmir.</div>}
    <div className="fixedsubtabs hrtabs ordertabs">
      <button className={tab === "leave" ? "on" : ""} onClick={() => setTab("leave")}>Məzuniyyət əmrləri</button>
      <button disabled title="Növbəti versiyada">İşdən çıxma əmrləri <small>tezliklə</small></button>
      <button disabled title="Növbəti versiyada">Digər əmrlər <small>tezliklə</small></button>
      <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Parametrlər</button>
    </div>
    {tab === "leave" ? <LeaveOrders data={data} send={send} /> : <OrderSettings data={data} send={send} />}
  </section>;
}

// ---------------------------------------------------------------- printing
function printOrder(order: Order, data: OrdersData) {
  const company = data.companies.find((c) => c.id === order.company_id);
  const items: string[] = (() => { try { return JSON.parse(order.items); } catch { return []; } })();
  const w = window.open("", "_blank", "width=820,height=960");
  if (!w) { window.alert("Çap pəncərəsi açılmadı — brauzerdə bu sayt üçün açılan pəncərələrə icazə verin."); return; }
  const h = escapeHtml;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Əmr № ${h(order.order_no)}</title><style>
    body{font:14px/1.6 "Times New Roman",serif;color:#000;margin:40px 56px}.firm{text-align:center;font-weight:bold;text-transform:uppercase;font-size:15px}
    h1{text-align:center;font-size:18px;margin:26px 0 4px;letter-spacing:.05em}.meta{display:flex;justify-content:space-between;margin:10px 0 18px}
    h2{text-align:center;font-size:15px;margin:0 0 18px}.center{text-align:center;font-weight:bold;margin:16px 0}ol{padding-left:22px}li{margin-bottom:8px;text-align:justify}
    .basis{margin-top:18px}.sign{margin-top:48px;display:flex;justify-content:space-between}.ack{margin-top:40px}.cancel{border:2px solid #b00;color:#b00;padding:6px 10px;text-align:center;font-weight:bold;margin-bottom:12px}
    @media print{body{margin:18mm 20mm}}
  </style></head><body>
  ${order.status === "cancelled" ? `<div class="cancel">LƏĞV EDİLİB${order.cancel_reason ? `: ${h(order.cancel_reason)}` : ""}</div>` : ""}
  <div class="firm">${h(company?.name || order.company_name || "")}</div>
  <h1>ƏMR № ${h(order.order_no)}</h1>
  <div class="meta"><span></span><span>${formatDay(order.order_date)}</span></div>
  <h2>${h(order.title)}</h2>
  ${order.legal_text ? `<p>${h(order.legal_text)},</p>` : ""}
  <p class="center">ƏMR EDİRƏM:</p>
  <ol>${items.map((i) => `<li>${h(i)}</li>`).join("")}</ol>
  ${order.basis ? `<p class="basis"><b>Əsas:</b> ${h(order.basis)}.</p>` : ""}
  <div class="sign"><span><b>Rəhbər</b></span><span>____________________ ${h(company?.manager || "")}</span></div>
  <div class="ack">Əmrlə tanış oldum: ____________________ ${h(personName(order))}&nbsp;&nbsp;&nbsp; «____» ______________ 20____</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------- leave orders
const emptyForm = (): Record<string, string> => ({ id: "", companyId: "", hrEmployeeId: "", kind: "annual", startDate: "", endDate: "", orderDate: todayIso(), basis: "İşçinin ərizəsi" });
type OrderColumn = ExcelColumn<Order> & { width: number; render: (o: Order) => React.ReactNode };
const ORDER_COLUMNS: OrderColumn[] = [
  { key: "no", label: "Əmr №", width: 90, search: (o) => o.order_no, sort: (o) => `${o.company_id}-${o.year}-${String(o.seq).padStart(6, "0")}`, render: (o) => <b>{o.order_no}</b> },
  { key: "date", label: "Tarix", width: 100, search: (o) => formatDay(o.order_date), sort: (o) => o.order_date, render: (o) => <>{formatDay(o.order_date)}</> },
  { key: "company", label: "Firma", width: 160, search: (o) => o.company_name || "", render: (o) => <>{o.company_name || "—"}</> },
  { key: "employee", label: "İşçi", width: 200, search: (o) => personName(o), render: (o) => <>{personName(o) || "—"}</> },
  { key: "kind", label: "Növ", width: 170, search: (o) => kindLabel(o.kind), render: (o) => <>{kindLabel(o.kind)}</> },
  { key: "period", label: "Dövr", width: 170, search: (o) => (o.start_date ? `${formatDay(o.start_date)} – ${formatDay(o.end_date)}` : ""), sort: (o) => o.start_date || "", render: (o) => <>{o.start_date ? `${formatDay(o.start_date)} – ${formatDay(o.end_date)}` : "—"}</> },
  { key: "days", label: "Gün", width: 60, search: (o) => String(o.days ?? ""), sort: (o) => Number(o.days || 0), render: (o) => <>{o.days ?? "—"}</> },
  { key: "status", label: "Status", width: 170, search: (o) => ORDER_STATUS_LABELS[o.status] || o.status, render: (o) => <span className={`orderstatus ${o.status}`}>{ORDER_STATUS_LABELS[o.status] || o.status}</span> },
  { key: "signed", label: "İmzalı nüsxə", width: 170, search: (o) => o.signed_name || "Yoxdur", render: (o) => o.signed_key ? <a href={fileUrl(o.signed_key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{o.signed_name || "Bax"}</a> : <span className="hrsub">Yüklənməyib</span> },
];

function LeaveOrders({ data, send }: { data: OrdersData; send: Send }) {
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const balance = emp && form.startDate ? leaveBalance(emp, leaves, params, form.startDate) : null;
  const pattern = emp?.company_id ? data.numbering.find((n) => n.company_id === emp.company_id && n.grp === "leave")?.pattern || ORDER_GROUPS[0].defaultPattern : "";
  const nextNo = emp?.company_id && !form.id ? orderNumber(pattern, Math.max(0, ...data.orders.filter((o) => o.company_id === emp.company_id && o.grp === "leave" && o.year === Number(form.orderDate.slice(0, 4))).map((o) => o.seq)) + 1, form.orderDate) : "";

  const { order, widths, setWidth, moveColumn } = useTableColumns("hrorders-leave", ORDER_COLUMNS.map((c) => c.key));
  const resize = useEdgeResize(setWidth, 50);
  const { dragProps } = useColumnDrag(moveColumn);
  const columnsByKey = Object.fromEntries(ORDER_COLUMNS.map((c) => [c.key, c]));
  const excel = useExcelFilters("hrorders-leave", ORDER_COLUMNS, data.orders.filter((o) => o.grp === "leave"));

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError(""); setNotice("");
    try { await work(); return true; } catch (e) { setError(e instanceof Error ? e.message : "Əməliyyat baş tutmadı."); return false; } finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save"); setError(""); setNotice("");
    try {
      const result = await send({ action: "leave", ...form });
      const saved = result.orders.find((o) => o.id === result.savedId);
      const isNew = !form.id;
      setForm(emptyForm()); setOpen(false);
      setNotice(saved ? `Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. Çap edib imzaladıqdan sonra imzalı nüsxəni yükləyin.` : "Əmr yadda saxlandı.");
      if (saved && window.confirm(`Əmr № ${saved.order_no} ${isNew ? "qeydə alındı" : "düzəldildi"}. İndi çap edilsin?`)) printOrder(saved, result);
    } catch (e) { setError(e instanceof Error ? e.message : "Əmr saxlanmadı."); } finally { setBusy(""); }
  };
  const edit = (o: Order) => {
    const e = data.employees.find((x) => x.id === o.hr_employee_id);
    setForm({ id: String(o.id), companyId: String(e?.company_id || ""), hrEmployeeId: String(o.hr_employee_id), kind: o.kind || "annual", startDate: o.start_date || "", endDate: o.end_date || "", orderDate: o.order_date, basis: o.basis || "" });
    setOpen(true); setError(""); setNotice("");
  };
  const cancel = (o: Order) => {
    const reason = window.prompt(`Əmr № ${o.order_no} ləğv edilsin?${o.status === "signed" ? "\nƏmr imzalanıb — onun əsasında qeydə alınmış məzuniyyət də kartdan silinəcək." : ""}\n\nLəğv etmənin səbəbini yazın:`);
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
      setNotice(o.status === "pending" ? `Əmr № ${o.order_no} imzalandı — məzuniyyət işçinin kartına yazıldı.` : `Əmr № ${o.order_no}: imzalı nüsxə yeniləndi.`);
    });
  };

  return <div className="ordersbody">
    {!open && <div className="hractions left"><Button onClick={() => { setForm(emptyForm()); setOpen(true); setError(""); setNotice(""); }}><Plus />Yeni məzuniyyət əmri</Button></div>}
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
      <div className="hractions"><button className="inlinecancel" disabled={Boolean(busy)} onClick={() => { setOpen(false); setForm(emptyForm()); }}>Ləğv et</button><Button disabled={Boolean(busy) || !form.hrEmployeeId || !form.startDate || !form.endDate || !plan?.days} onClick={() => void save()}>{busy === "save" ? "Saxlanılır..." : form.id ? "Dəyişiklikləri saxla" : "Əmri qeydə al"}</Button></div>
    </div>}
    <div className="tasktablewrap"><table className="tasktable hrtable"><ColGroup order={order} defaultWidths={Object.fromEntries(ORDER_COLUMNS.map((c) => [c.key, c.width]))} widths={widths} extraKeys={["actions"]} />
      <thead><tr>{order.map((key) => <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(columnsByKey[key])}</SortableTh>)}<th {...resize("actions")} className={`opencolumn${resize("actions").className ? ` ${resize("actions").className}` : ""}`}><ActionsHeader /></th></tr></thead>
      <tbody>{excel.rows.map((o) => <tr key={o.id} className={o.status === "cancelled" ? "ordercancelled" : o.status === "pending" ? "orderpending" : ""}>
        {order.map((key) => <td key={key} data-label={columnsByKey[key].label}>{columnsByKey[key].render(o)}</td>)}
        <td data-label="Əməliyyat"><div className="tableactions">
          <button className="editcompanybtn" onClick={() => printOrder(o, data)}><Printer />Çap et</button>
          {o.status !== "cancelled" && <label className={`editcompanybtn orderupload${o.status === "pending" ? " need" : ""}`}>{busy === `sign${o.id}` ? "Yüklənir..." : <><Upload />{o.signed_key ? "Nüsxəni dəyiş" : "İmzalı nüsxəni yüklə"}</>}<input type="file" accept="image/*,application/pdf" disabled={Boolean(busy)} onChange={(e) => { upload(o, e.target.files?.[0]); e.target.value = ""; }} /></label>}
          {o.status === "pending" && <button className="editcompanybtn" onClick={() => edit(o)}>Düzəlt</button>}
          {o.status !== "cancelled" && <button className="deletetaskbtn" disabled={Boolean(busy)} onClick={() => cancel(o)}>Ləğv et</button>}
          {o.status === "cancelled" && o.cancel_reason && <small className="hrsub" title={o.cancel_reason}>Səbəb: {o.cancel_reason}</small>}
        </div></td>
      </tr>)}</tbody></table>
      {!excel.rows.length && <div className="empty"><p>{data.orders.some((o) => o.grp === "leave") ? "Filtrə uyğun əmr tapılmadı." : "Hələ məzuniyyət əmri yoxdur. “Yeni məzuniyyət əmri” düyməsi ilə başlayın."}</p></div>}
    </div>
  </div>;
}

// ---------------------------------------------------------------- settings: number patterns per firm and the Labour Code articles
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const today = todayIso();
  const save = async () => {
    setBusy(true); setError(""); setSaved("");
    try {
      const numbering = data.companies.flatMap((c) => ORDER_GROUPS.map((g) => ({ companyId: c.id, grp: g.key, pattern: patterns[`${c.id}:${g.key}`] || "" })));
      await send({ action: "settings", numbering, legal });
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
    {error && <div className="errorbox">{error}</div>}
    {saved && <div className="hrok">{saved}</div>}
    <div className="hractions"><Button disabled={busy} onClick={() => void save()}>{busy ? "Saxlanılır..." : "Yadda saxla"}</Button></div>
  </div>;
}

