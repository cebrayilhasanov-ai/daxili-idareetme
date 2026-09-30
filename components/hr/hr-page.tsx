"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ColGroup, SortableTh, useColumnDrag, useEdgeResize, useExcelFilters, useTableColumns, type ExcelColumn } from "@/components/table-kit";
import {
  CALENDAR_KINDS, EDUCATION_LEVELS, FAMILY_RELATIONS, LEAVE_KINDS, MARITAL_STATUSES, TERMINATION_REASONS, addMonths, averageEarnings, formatDay, indexCalendar, isIsoDate, leaveBalance,
  leaveDaysBetween, leaveKindLabel, monthEnd, monthStart, normalizeParams, priorService, round2, serviceParts, serviceText, settlement, todayIso,
  weekday, workNorm, type CalendarDay, type CalendarKind, type HrParams,
} from "@/lib/hr-calc";

// HR section (kadr uçotu): the register of every worker of every firm — most of them never sign in to the app — with
// ID card data, leave records and balances, monthly earnings, the final settlement on termination and the production calendar.

type HrEmployee = {
  id: number; company_id: number | null; company_name: string | null; department: string | null; position: string | null;
  last_name: string; first_name: string; patronymic: string | null; fin: string | null; id_series: string | null; id_number: string | null;
  id_issued_by: string | null; id_issued_at: string | null; id_valid_until: string | null; birth_date: string | null; gender: string | null;
  reg_address: string | null; phone: string | null; id_front_key: string | null; id_front_name: string | null; id_back_key: string | null; id_back_name: string | null;
  hire_date: string; termination_date: string | null; termination_reason: string | null; prior_experience_months: number; base_leave_days: number | null;
  extra_leave_days: number; extra_leave_note: string | null; work_week: number; monthly_salary: number | null; opening_balance_date: string | null;
  opening_balance_days: number | null; user_employee_id: number | null; user_employee_name: string | null; note: string | null;
  photo_key: string | null; photo_name: string | null; prior_experience_days: number | null;
  contract_no: string | null; contract_date: string | null; contract_type: string | null; contract_end_date: string | null; probation_months: number | null;
  hire_order_no: string | null; hire_order_date: string | null; emergency_name: string | null; emergency_relation: string | null; emergency_phone: string | null; marital_status: string | null;
};
type HrFamily = { id: number; hr_employee_id: number; relation: string; last_name: string | null; first_name: string; patronymic: string | null; birth_date: string | null; workplace: string | null; phone: string | null };
type HrEducation = { id: number; hr_employee_id: number; level: string; institution: string; specialty: string | null; start_year: number | null; end_year: number | null; diploma_no: string | null; diploma_key: string | null; diploma_name: string | null };
type HrPriorJob = { id: number; hr_employee_id: number; customer_id: number; customer_name: string | null; customer_voen: string | null; position: string; start_date: string; end_date: string; termination_reason: string | null };
type HrCustomer = { id: number; voen: string | null; name: string; country: string | null };
type HrLeave = { id: number; hr_employee_id: number; kind: string; start_date: string; end_date: string; days: number; order_no: string | null; order_date: string | null; note: string | null };
type HrSalary = { hr_employee_id: number; period: string; amount: number };
type HrData = {
  employees: HrEmployee[]; leaves: HrLeave[]; salaries: HrSalary[]; calendar: CalendarDay[]; params: HrParams;
  companies: { id: number; name: string }[]; users: { id: number; name: string }[]; structure: { company_id: number; department: string; title: string }[];
  priorJobs: HrPriorJob[]; customers: HrCustomer[]; family: HrFamily[]; education: HrEducation[];
};
type Call = (method: "POST" | "DELETE", payload: Record<string, unknown> | string) => Promise<HrData & { savedId?: number; customerId?: number }>;
export type HrSection = "personnel" | "calendar" | "settings" | "customers";

const fullName = (e: HrEmployee) => [e.last_name, e.first_name, e.patronymic].filter(Boolean).join(" ");
const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const money = (value: number) => `${value.toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
const reasonLabel = (key: string | null) => TERMINATION_REASONS.find((r) => r.key === key)?.label || key || "—";
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const WEEKDAYS = ["B.e.", "Ç.a.", "Çər.", "C.a.", "Cümə", "Şən.", "Baz."];
const periodLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

// A fixed-term contract that has run out or ends within 30 days (only for people still working).
function contractAlert(e: HrEmployee, today: string) {
  if (e.termination_date || e.contract_type !== "fixed" || !e.contract_end_date) return null;
  const left = Math.round((Date.parse(`${e.contract_end_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return left <= 30 ? left : null;
}

function idStatus(e: HrEmployee, today: string) {
  if (!e.id_valid_until) return { cls: "", text: "—" };
  const left = Math.round((Date.parse(`${e.id_valid_until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (left < 0) return { cls: "hrbad", text: `Bitib (${formatDay(e.id_valid_until)})` };
  if (left <= 30) return { cls: "hrwarn", text: `${left} gün qalıb` };
  return { cls: "", text: formatDay(e.id_valid_until) };
}

export function HrPage({ section }: { section: HrSection }) {
  const [data, setData] = useState<HrData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hr").then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!cancelled) setData(body); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "HR məlumatları açılmadı."); });
    return () => { cancelled = true; };
  }, []);
  const call: Call = async (method, payload) => {
    const response = method === "DELETE"
      ? await fetch(`/api/hr?${payload}`, { method })
      : await fetch("/api/hr", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Əməliyyat baş tutmadı.");
    setData(body);
    return body;
  };
  if (error) return <section className="panel pagepanel directorypanel"><div className="errorbox">{error}</div></section>;
  if (!data) return <section className="panel pagepanel directorypanel"><div className="loading">HR məlumatları yüklənir...</div></section>;
  if (section === "calendar") return <CalendarSection data={data} call={call} />;
  if (section === "settings") return <SettingsSection data={data} call={call} />;
  if (section === "customers") return <CustomerReportSection data={data} />;
  return <PersonnelSection data={data} call={call} />;
}

// ---------------------------------------------------------------- İşçilər
type PersonnelRow = { e: HrEmployee; balance: ReturnType<typeof leaveBalance>; id: { cls: string; text: string } };
type PersonnelColumn = ExcelColumn<PersonnelRow> & { width: number; render: (row: PersonnelRow) => React.ReactNode };
const PERSONNEL_COLUMNS: { key: string; width: number }[] = [
  { key: "name", width: 230 }, { key: "company", width: 180 }, { key: "position", width: 160 }, { key: "phone", width: 140 }, { key: "hire", width: 110 },
  { key: "service", width: 130 }, { key: "balance", width: 130 }, { key: "idcard", width: 140 }, { key: "status", width: 120 },
];
function personnelColumns(today: string): PersonnelColumn[] {
  const width = (key: string) => PERSONNEL_COLUMNS.find((c) => c.key === key)?.width || 140;
  return [
    { key: "name", label: "İşçi", width: width("name"), search: (r) => fullName(r.e), render: (r) => <span className="hrperson"><HrAvatar employee={r.e} /><span><b>{fullName(r.e)}</b>{r.e.fin && <small className="hrsub">FİN {r.e.fin}</small>}</span></span> },
    { key: "company", label: "Firma / şöbə", width: width("company"), search: (r) => r.e.company_name || "", render: (r) => <>{r.e.company_name || "—"}{r.e.department && <small className="hrsub">{r.e.department}</small>}</> },
    { key: "position", label: "Vəzifə", width: width("position"), search: (r) => r.e.position || "", render: (r) => <>{r.e.position || "—"}</> },
    { key: "phone", label: "Telefon", width: width("phone"), search: (r) => r.e.phone || "", render: (r) => <>{r.e.phone || "—"}</> },
    { key: "hire", label: "İşə qəbul", width: width("hire"), search: (r) => formatDay(r.e.hire_date), sort: (r) => r.e.hire_date, render: (r) => <>{formatDay(r.e.hire_date)}</> },
    { key: "service", label: "Staj (bu firmada)", width: width("service"), search: (r) => serviceText(serviceParts(r.e.hire_date, r.e.termination_date || today)), sort: (r) => r.e.hire_date, render: (r) => <>{serviceText(serviceParts(r.e.hire_date, r.e.termination_date || today))}</> },
    { key: "balance", label: "Məzuniyyət qalığı", width: width("balance"), search: (r) => `${days(r.balance.balance)} gün`, sort: (r) => r.balance.balance, render: (r) => <b className={r.balance.balance < 0 ? "hrneg" : "hrpos"}>{days(r.balance.balance)} gün</b> },
    { key: "idcard", label: "Vəsiqə etibarlıdır", width: width("idcard"), search: (r) => r.id.text, sort: (r) => r.e.id_valid_until || "", render: (r) => <span className={r.id.cls}>{r.id.text}</span> },
    { key: "status", label: "Status", width: width("status"), search: (r) => r.e.termination_date ? "İşdən çıxıb" : "İşləyir", render: (r) => r.e.termination_date ? <span className="hrtag off">Çıxıb {formatDay(r.e.termination_date)}</span> : <span className="hrtag on">İşləyir</span> },
  ];
}
function PersonnelSection({ data, call }: { data: HrData; call: Call }) {
  const today = todayIso();
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState<"active" | "terminated" | "all" | "idalert" | "contractalert">("active");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | "new" | null>(null);
  const params = useMemo(() => normalizeParams(data.params), [data.params]);
  const rows = useMemo(() => data.employees.map((e) => {
    const leaves = data.leaves.filter((l) => l.hr_employee_id === e.id);
    const balance = leaveBalance(e, leaves, params, today);
    return { e, balance, id: idStatus(e, today) };
  }), [data, params, today]);
  const idAlerts = rows.filter((r) => !r.e.termination_date && (r.id.cls === "hrbad" || r.id.cls === "hrwarn"));
  const contractAlerts = rows.filter((r) => contractAlert(r.e, today) !== null);
  const q = query.trim().toLocaleLowerCase("az");
  const shown = rows.filter(({ e, id }) =>
    (!companyId || String(e.company_id) === companyId)
    && (status === "all" || (status === "active" && !e.termination_date) || (status === "terminated" && Boolean(e.termination_date)) || (status === "idalert" && !e.termination_date && Boolean(id.cls)) || (status === "contractalert" && contractAlert(e, today) !== null))
    && (!q || `${fullName(e)} ${e.fin || ""} ${e.position || ""} ${e.department || ""}`.toLocaleLowerCase("az").includes(q)));
  const open = openId === "new" ? null : data.employees.find((e) => e.id === openId) || null;
  // Columns work like the other lists: drag to reorder, resize from the right edge, Excel-like filter and sort in each header.
  const { order, widths, setWidth, moveColumn } = useTableColumns("hrpersonnel", PERSONNEL_COLUMNS.map((c) => c.key));
  const resize = useEdgeResize(setWidth, 60);
  const { dragProps } = useColumnDrag(moveColumn);
  const columns = personnelColumns(today);
  const columnsByKey = Object.fromEntries(columns.map((c) => [c.key, c]));
  const defaultWidths = Object.fromEntries(columns.map((c) => [c.key, c.width]));
  const excel = useExcelFilters("hrpersonnel", columns, shown);
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Personallar</h2><p>{excel.rows.length} işçi göstərilir · qalıqlar {formatDay(today)} tarixinə</p></div><Button onClick={() => setOpenId("new")}><Plus />Yeni işçi</Button></div>
    {idAlerts.length > 0 && <button className="hralert" onClick={() => setStatus("idalert")}>⚠ {idAlerts.length} işçinin şəxsiyyət vəsiqəsinin müddəti bitib və ya 30 gün ərzində bitir — göstər</button>}
    {contractAlerts.length > 0 && <button className="hralert" onClick={() => setStatus("contractalert")}>⚠ {contractAlerts.length} işçinin müddətli əmək müqaviləsinin müddəti bitib və ya 30 gün ərzində bitir — göstər</button>}
    <div className="hrfilters">
      <label>Firma<select value={companyId} onChange={(e) => setCompanyId(e.target.value)}><option value="">Bütün firmalar</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="active">İşləyənlər</option><option value="terminated">İşdən çıxanlar</option><option value="idalert">Vəsiqəsi bitənlər</option><option value="contractalert">Müqaviləsi bitənlər</option><option value="all">Hamısı</option></select></label>
      <label className="hrsearch">Axtarış<Input value={query} placeholder="Ad, FİN, vəzifə, şöbə..." onChange={(e) => setQuery(e.target.value)} /></label>
    </div>
    <div className="tasktablewrap"><table className="tasktable hrtable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} />
      <thead><tr>{order.map((key) => <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(columnsByKey[key])}</SortableTh>)}</tr></thead>
      <tbody>{excel.rows.map((row) => <tr key={row.e.id} className="hrrow" onClick={() => setOpenId(row.e.id)}>
        {order.map((key) => <td key={key} data-label={columnsByKey[key].label}>{columnsByKey[key].render(row)}</td>)}
      </tr>)}</tbody></table>
      {!excel.rows.length && <div className="empty"><p>{data.employees.length ? "Filtrə uyğun işçi tapılmadı." : "Hələ işçi əlavə edilməyib. “Yeni işçi” düyməsi ilə başlayın."}</p></div>}
    </div>
    <Dialog open={openId !== null} onOpenChange={(v) => { if (!v) setOpenId(null); }}>
      <DialogContent className="businessdialog hrdialog" resizable>
        {openId !== null && <EmployeeDialog key={String(openId)} employee={open} data={data} call={call} onSaved={(id) => setOpenId(id)} onClose={() => setOpenId(null)} />}
      </DialogContent>
    </Dialog>
  </section>;
}

type Tab = "card" | "family" | "leaves" | "salary" | "settlement";
function EmployeeDialog({ employee, data, call, onSaved, onClose }: { employee: HrEmployee | null; data: HrData; call: Call; onSaved: (id: number) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("card");
  return <>
    <DialogHeader className="businessdialogheader"><span className="formeyebrow">KADR UÇOTU</span><DialogTitle className="hrdialogtitle">{employee && <HrAvatar employee={employee} size={40} />}{employee ? fullName(employee) : "Yeni işçi"}</DialogTitle>
      <DialogDescription>{employee ? [employee.position, employee.company_name, `işə qəbul ${formatDay(employee.hire_date)}`].filter(Boolean).join(" · ") : "Şəxsiyyət vəsiqəsi, iş yeri və məzuniyyət məlumatlarını daxil edin. Bu işçi sistemə giriş almır."}</DialogDescription></DialogHeader>
    {employee && <div className="fixedsubtabs hrtabs">
      {([["card", "Şəxsi kart"], ["family", "Ailə və təhsil"], ["leaves", "Məzuniyyətlər"], ["salary", "Əmək haqqı"], ["settlement", "Son hesablaşma"]] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </div>}
    <div className="hrdialogbody">
      {tab === "card" && <CardTab employee={employee} data={data} call={call} onSaved={onSaved} onClose={onClose} />}
      {employee && tab === "family" && <FamilyTab employee={employee} data={data} call={call} />}
      {employee && tab === "leaves" && <LeavesTab employee={employee} data={data} call={call} />}
      {employee && tab === "salary" && <SalaryTab employee={employee} data={data} call={call} />}
      {employee && tab === "settlement" && <SettlementTab employee={employee} data={data} call={call} />}
    </div>
  </>;
}

function toForm(e: HrEmployee | null): Record<string, string> {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const prior = e?.prior_experience_months || 0;
  return {
    id: s(e?.id), lastName: s(e?.last_name), firstName: s(e?.first_name), patronymic: s(e?.patronymic), birthDate: s(e?.birth_date), gender: s(e?.gender), phone: s(e?.phone),
    photoKey: s(e?.photo_key), photoName: s(e?.photo_name),
    fin: s(e?.fin), idSeries: e ? s(e.id_series) : "AA", idNumber: s(e?.id_number), idIssuedBy: s(e?.id_issued_by), idIssuedAt: s(e?.id_issued_at), idValidUntil: s(e?.id_valid_until), regAddress: s(e?.reg_address),
    idFrontKey: s(e?.id_front_key), idFrontName: s(e?.id_front_name), idBackKey: s(e?.id_back_key), idBackName: s(e?.id_back_name),
    companyId: s(e?.company_id), department: s(e?.department), position: s(e?.position), hireDate: s(e?.hire_date), workWeek: s(e?.work_week || 5), monthlySalary: s(e?.monthly_salary), userEmployeeId: s(e?.user_employee_id),
    priorYears: prior ? String(Math.floor(prior / 12)) : "", priorMonths: prior ? String(prior % 12) : "", priorDays: e?.prior_experience_days ? String(e.prior_experience_days) : "",
    baseLeaveDays: s(e?.base_leave_days), extraLeaveDays: e?.extra_leave_days ? String(e.extra_leave_days) : "", extraLeaveNote: s(e?.extra_leave_note),
    openingBalanceDate: s(e?.opening_balance_date), openingBalanceDays: s(e?.opening_balance_days), terminationDate: s(e?.termination_date), terminationReason: s(e?.termination_reason), note: s(e?.note),
    contractNo: s(e?.contract_no), contractDate: s(e?.contract_date), contractType: s(e?.contract_type), contractEndDate: s(e?.contract_end_date), probationMonths: s(e?.probation_months),
    hireOrderNo: s(e?.hire_order_no), hireOrderDate: s(e?.hire_order_date), emergencyName: s(e?.emergency_name), emergencyRelation: s(e?.emergency_relation), emergencyPhone: s(e?.emergency_phone),
  };
}
type JobRow = { key: string; customerId: string; position: string; startDate: string; endDate: string; terminationReason: string };
let jobKey = 0;
const newJobRow = (): JobRow => ({ key: `job${++jobKey}`, customerId: "", position: "", startDate: "", endDate: "", terminationReason: "" });
const toJobRows = (employee: HrEmployee | null, jobs: HrPriorJob[]): JobRow[] => employee
  ? jobs.filter((j) => j.hr_employee_id === employee.id).map((j) => ({ key: `db${j.id}`, customerId: String(j.customer_id), position: j.position, startDate: j.start_date, endDate: j.end_date, terminationReason: j.termination_reason || "" }))
  : [];
const toPayload = (f: Record<string, string>, jobs: JobRow[]) => ({
  action: "employee", ...f, priorExperienceMonths: (Number(f.priorYears) || 0) * 12 + (Number(f.priorMonths) || 0), priorExperienceDays: Number(f.priorDays) || 0,
  priorJobs: jobs.map((j) => ({ customerId: Number(j.customerId) || null, position: j.position, startDate: j.startDate, endDate: j.endDate, terminationReason: j.terminationReason })),
});
const RELATIONS = ["Həyat yoldaşı", "Ata", "Ana", "Qardaş", "Bacı", "Övlad", "Digər qohum", "Dost"];
const CUSTOMER_TYPES = ["Hüquqi şəxs", "Fərdi sahibkar", "Fiziki şəxs"];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toLocaleUpperCase("az")).join("");
function HrAvatar({ employee, size = 28 }: { employee: Pick<HrEmployee, "photo_key" | "last_name" | "first_name">; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return employee.photo_key
    ? <img className="hravatar" style={style} src={`/api/file?key=${encodeURIComponent(employee.photo_key)}`} alt="" />
    : <span className="hravatar" style={style}>{initialsOf(`${employee.first_name} ${employee.last_name}`)}</span>;
}

// A new row gets its key when the user adds it (never during render); rows from the database are keyed by their id.
// One earlier employer: picked from the customer list by VÖEN or name; an unknown VÖEN can be added to that list on the spot.
function PriorJobRow({ row, index, customers, onChange, onRemove, onCreateCustomer }: {
  row: JobRow; index: number; customers: HrCustomer[]; onChange: (row: JobRow) => void; onRemove: () => void;
  onCreateCustomer: (customer: Record<string, string>) => Promise<number>;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = customers.find((c) => String(c.id) === row.customerId);
  const q = query.trim().toLocaleLowerCase("az");
  const matches = q.length >= 2 ? customers.filter((c) => (c.voen || "").toLocaleLowerCase("az").includes(q) || c.name.toLocaleLowerCase("az").includes(q)).slice(0, 6) : [];
  const typedVoen = query.trim().toUpperCase();
  const unknownVoen = /^[0-9A-Z]{7,10}$/.test(typedVoen) && /\d/.test(typedVoen) && !customers.some((c) => (c.voen || "").toUpperCase() === typedVoen);
  const own = isIsoDate(row.startDate) && isIsoDate(row.endDate) && row.endDate >= row.startDate ? serviceText(serviceParts(row.startDate, row.endDate)) : "—";
  const pick = (id: number) => { onChange({ ...row, customerId: String(id) }); setQuery(""); setCreating(null); setError(""); };
  const create = async () => {
    if (!creating) return;
    setBusy(true); setError("");
    try { pick(await onCreateCustomer({ ...creating, voen: typedVoen })); } catch (e) { setError(e instanceof Error ? e.message : "Müştəri yaradılmadı."); } finally { setBusy(false); }
  };
  return <div className="hrjob">
    <span className="hrjobno">{index + 1}</span>
    <div className="hrjobfields">
      <label className="field hrjobplace">İş yeri (müştəri siyahısından) *
        {chosen
          ? <span className="hrjobchosen"><b>{chosen.name}</b><small>{chosen.voen ? `VÖEN ${chosen.voen}` : chosen.country || ""}</small><button type="button" className="hrlink" onClick={() => onChange({ ...row, customerId: "" })}>dəyiş</button></span>
          : <span className="hrjobpick"><Input value={query} placeholder="VÖEN və ya ad yazın" onChange={(e) => { setQuery(e.target.value); setCreating(null); }} />
            {matches.length > 0 && <span className="hrjobmatches">{matches.map((c) => <button type="button" key={c.id} onClick={() => pick(c.id)}><b>{c.name}</b><small>{c.voen || c.country || ""}</small></button>)}</span>}
            {unknownVoen && !creating && <small className="hrwarn">VÖEN {typedVoen} müştəri siyahısında yoxdur · <button type="button" className="hrlink hrlinkok" onClick={() => setCreating({ entityType: "Hüquqi şəxs", name: "", legalAddress: "", manager: "", phone: "" })}>müştəri kartını yarat</button></small>}
          </span>}
      </label>
      <label className="field">Vəzifə *<Input value={row.position} onChange={(e) => onChange({ ...row, position: e.target.value })} /></label>
      <label className="field">Başlama tarixi *<Input type="date" value={row.startDate} onChange={(e) => onChange({ ...row, startDate: e.target.value })} /></label>
      <label className="field">Bitmə tarixi *<Input type="date" value={row.endDate} onChange={(e) => onChange({ ...row, endDate: e.target.value })} /></label>
      <label className="field">İşdən çıxma əsası *<select value={row.terminationReason} onChange={(e) => onChange({ ...row, terminationReason: e.target.value })}><option value="">Seçin</option>{TERMINATION_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <span className="field hrjobservice">Staj<b>{own}</b></span>
    </div>
    <button type="button" className="hrlink hrjobremove" title="Sətri sil" onClick={onRemove}>✕</button>
    {creating && <div className="hrjobcreate">
      <b>Yeni müştəri kartı · VÖEN {typedVoen}</b>
      <div className="hrgrid">
        <label className="field">Statusu<select value={creating.entityType} onChange={(e) => setCreating({ ...creating, entityType: e.target.value })}>{CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="field">Adı *<Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></label>
        <label className="field">Hüquqi ünvanı *<Input value={creating.legalAddress} onChange={(e) => setCreating({ ...creating, legalAddress: e.target.value })} /></label>
        <label className="field">Rəhbəri *<Input value={creating.manager} onChange={(e) => setCreating({ ...creating, manager: e.target.value })} /></label>
        <label className="field">Telefonu *<Input inputMode="tel" placeholder="+994 12 345 67 89" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} /></label>
      </div>
      {error && <small className="hrbad">{error}</small>}
      <div className="hractions"><button type="button" className="inlinecancel" disabled={busy} onClick={() => setCreating(null)}>Ləğv et</button><Button type="button" disabled={busy || !creating.name.trim() || !creating.legalAddress.trim() || !creating.manager.trim() || !creating.phone.trim()} onClick={() => void create()}>{busy ? "Yaradılır..." : "Müştəri siyahısına əlavə et"}</Button></div>
    </div>}
  </div>;
}

function CardTab({ employee, data, call, onSaved, onClose }: { employee: HrEmployee | null; data: HrData; call: Call; onSaved: (id: number) => void; onClose: () => void }) {
  const [form, setForm] = useState(() => toForm(employee));
  const [jobs, setJobs] = useState(() => toJobRows(employee, data.priorJobs));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const structure = data.structure.filter((s) => String(s.company_id) === form.companyId);
  const departments = [...new Set(structure.map((s) => s.department).filter(Boolean))];
  const positions = [...new Set(structure.filter((s) => !form.department || s.department === form.department).map((s) => s.title).filter(Boolean))];
  const params = normalizeParams(data.params);
  // With earlier employers listed, prior service comes from their dates and its fields are read-only.
  const prior = jobs.length ? priorService(jobs.map((j) => ({ start_date: j.startDate, end_date: j.endDate }))) : null;
  const upload = async (target: "Front" | "Back" | "Photo", file: File | undefined) => {
    if (!file) return;
    setError(""); setUploading(target);
    try {
      if (target === "Photo" && !file.type.startsWith("image/")) throw new Error("Şəkil faylı seçin (JPG, PNG və s.).");
      const limit = target === "Photo" ? 5 : 10;
      if (file.size > limit * 1024 * 1024) throw new Error(`${target === "Photo" ? "Şəklin" : "Skan faylının"} həcmi ${limit} MB-dan çox ola bilməz.`);
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/file", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fayl yüklənmədi.");
      const prefix = target === "Photo" ? "photo" : `id${target}`;
      setForm((f) => ({ ...f, [`${prefix}Key`]: result.key, [`${prefix}Name`]: result.name }));
    } catch (e) { setError(e instanceof Error ? e.message : "Fayl yüklənmədi."); } finally { setUploading(""); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const result = await call("POST", toPayload(form, jobs));
      if (!employee && result.savedId) onSaved(result.savedId);
      else { setForm(toForm(result.employees.find((e) => e.id === employee?.id) || null)); setJobs(toJobRows(employee, result.priorJobs)); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); } finally { setBusy(false); }
  };
  const createCustomer = async (customer: Record<string, string>) => {
    const result = await call("POST", { action: "customer", customer });
    if (!result.customerId) throw new Error("Müştəri yaradılmadı.");
    return result.customerId;
  };
  const remove = async () => {
    if (!employee || !window.confirm(`${fullName(employee)} adlı işçinin kartını, bütün məzuniyyət və əmək haqqı qeydləri ilə birlikdə silmək istəyirsiniz?\n\nİşdən çıxan işçini silməyin — “İşdən çıxma tarixi”ni yazın ki, tarixçə qalsın.`)) return;
    setBusy(true); setError("");
    try { await call("DELETE", `type=employee&id=${employee.id}`); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Silinmədi."); setBusy(false); }
  };
  const field = (label: string, key: string, props: Record<string, unknown> = {}) => <label className="field">{label}<Input value={form[key] || ""} onChange={(e) => set(key)(e.target.value)} {...props} /></label>;
  const scan = (side: "Front" | "Back", label: string) => <label className="field">{label}
    <span className="hrscan"><Input type="file" accept="image/*,application/pdf" disabled={Boolean(uploading)} onChange={(e) => void upload(side, e.target.files?.[0])} />
      {uploading === side ? <small>Yüklənir...</small> : form[`id${side}Key`] ? <small><a href={`/api/file?key=${encodeURIComponent(form[`id${side}Key`])}`} target="_blank" rel="noreferrer">{form[`id${side}Name`] || "Bax"}</a> · <button type="button" className="hrlink" onClick={() => setForm((f) => ({ ...f, [`id${side}Key`]: "", [`id${side}Name`]: "" }))}>götür</button></small> : null}</span></label>;
  const digitsOnly = (key: string, max?: number) => ({ inputMode: "numeric" as const, readOnly: Boolean(prior), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key)(e.target.value.replace(/\D/g, "").slice(0, max)) });
  const phoneProps = { inputMode: "tel", placeholder: "+994 50 123 45 67" };
  const canSave = form.lastName.trim() && form.firstName.trim() && form.hireDate && form.phone.trim();
  return <div className="hrcard">
    <fieldset><legend>Şəxsi məlumatlar</legend><div className="hrpersonal">
      <div className="hrphoto">
        {form.photoKey ? <img src={`/api/file?key=${encodeURIComponent(form.photoKey)}`} alt="" /> : <span>{initialsOf(`${form.firstName} ${form.lastName}`) || "📷"}</span>}
        <label className="hrphotobtn">{uploading === "Photo" ? "Yüklənir..." : form.photoKey ? "Şəkli dəyiş" : "Şəkil yüklə"}<input type="file" accept="image/*" disabled={Boolean(uploading)} onChange={(e) => { void upload("Photo", e.target.files?.[0]); e.target.value = ""; }} /></label>
        {form.photoKey && <button type="button" className="hrlink" onClick={() => setForm((f) => ({ ...f, photoKey: "", photoName: "" }))}>götür</button>}
      </div>
      <div className="hrgrid">
        {field("Soyad *", "lastName")}{field("Ad *", "firstName")}{field("Ata adı", "patronymic")}
        {field("Doğum tarixi", "birthDate", { type: "date" })}
        <label className="field">Cins<select value={form.gender} onChange={(e) => set("gender")(e.target.value)}><option value="">—</option><option value="Kişi">Kişi</option><option value="Qadın">Qadın</option></select></label>
        {field("Telefon *", "phone", phoneProps)}
      </div>
    </div></fieldset>
    <fieldset><legend>Təcili əlaqə şəxsi</legend><div className="hrgrid">
      {field("Adı, soyadı", "emergencyName")}
      <label className="field">Qohumluq<Input list="hr-relations" value={form.emergencyRelation} onChange={(e) => set("emergencyRelation")(e.target.value)} /><datalist id="hr-relations">{RELATIONS.map((r) => <option key={r} value={r} />)}</datalist></label>
      {field(form.emergencyName.trim() ? "Telefon *" : "Telefon", "emergencyPhone", phoneProps)}
    </div></fieldset>
    <fieldset><legend>Şəxsiyyət vəsiqəsi</legend><div className="hrgrid">
      {field("FİN", "fin", { maxLength: 7, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("fin")(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7)) })}
      <label className="field">Seriya<select value={form.idSeries} onChange={(e) => set("idSeries")(e.target.value)}><option value="">—</option><option value="AA">AA</option><option value="AZE">AZE</option><option value="MYİ">MYİ (müvəqqəti yaşayış)</option><option value="DYİ">DYİ (daimi yaşayış)</option></select></label>
      {field("Nömrə", "idNumber")}
      {field("Verən orqan", "idIssuedBy")}
      {field("Verilmə tarixi", "idIssuedAt", { type: "date" })}
      {field("Etibarlıdır (tarixədək)", "idValidUntil", { type: "date" })}
      <label className="field hrwide">Qeydiyyat ünvanı<Input value={form.regAddress} onChange={(e) => set("regAddress")(e.target.value)} /></label>
      {scan("Front", "Vəsiqənin ön tərəfi (skan)")}{scan("Back", "Vəsiqənin arxa tərəfi (skan)")}
    </div></fieldset>
    <fieldset><legend>İş yeri</legend><div className="hrgrid">
      <label className="field">Firma<select value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}><option value="">Seçin</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Şöbə<Input list="hr-departments" value={form.department} onChange={(e) => set("department")(e.target.value)} placeholder={departments.length ? "Siyahıdan seçin və ya yazın" : ""} /><datalist id="hr-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist></label>
      <label className="field">Vəzifə<Input list="hr-positions" value={form.position} onChange={(e) => set("position")(e.target.value)} /><datalist id="hr-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist></label>
      {field("İşə qəbul tarixi *", "hireDate", { type: "date" })}
      <label className="field">İş həftəsi<select value={form.workWeek} onChange={(e) => set("workWeek")(e.target.value)}><option value="5">5 günlük</option><option value="6">6 günlük</option></select></label>
      {field("Vəzifə maaşı (₼)", "monthlySalary", { inputMode: "decimal" })}
      <label className="field">Sistem istifadəçisi (istəyə bağlı)<select value={form.userEmployeeId} onChange={(e) => set("userEmployeeId")(e.target.value)}><option value="">— sistemdə işləmir —</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    </div></fieldset>
    <fieldset><legend>Əvvəlki iş yerləri</legend>
      {jobs.length ? <div className="hrjobs">{jobs.map((row, i) => <PriorJobRow key={row.key} row={row} index={i} customers={data.customers}
        onChange={(next) => setJobs((list) => list.map((j) => j.key === row.key ? next : j))} onRemove={() => setJobs((list) => list.filter((j) => j.key !== row.key))} onCreateCustomer={createCustomer} />)}</div>
        : <small className="hrhint">Əvvəlki iş yeri əlavə edilməyib. Əlavə etsəniz, əvvəlki staj onların tarixlərinə görə avtomatik hesablanacaq.</small>}
      <div className="hractions left"><button type="button" className="hraddrow" onClick={() => setJobs((list) => [...list, newJobRow()])}><Plus />Əvvəlki iş yeri əlavə et</button>{prior && <span className="hrjobtotal">Əvvəlki iş yerlərindəki ümumi staj: <b>{serviceText(prior)}</b></span>}</div>
      {prior && jobs.length > 1 && <small className="hrhint">Eyni vaxtda bir neçə yerdə işlənmiş dövrlər bir dəfə sayılır; günlər toplananda 30 gün 1 ay sayılır.</small>}
    </fieldset>
    <fieldset><legend>Əmək müqaviləsi</legend><div className="hrgrid">
      {field("Müqavilənin nömrəsi", "contractNo")}
      {field("Müqavilənin tarixi", "contractDate", { type: "date" })}
      <label className="field">Növü<select value={form.contractType} onChange={(e) => set("contractType")(e.target.value)}><option value="">—</option><option value="indefinite">Müddətsiz</option><option value="fixed">Müddətli</option></select></label>
      {form.contractType === "fixed" && field("Bitmə tarixi *", "contractEndDate", { type: "date" })}
      <label className="field">Sınaq müddəti<select value={form.probationMonths} onChange={(e) => set("probationMonths")(e.target.value)}><option value="">—</option><option value="0">Yoxdur</option><option value="1">1 ay</option><option value="2">2 ay</option><option value="3">3 ay</option></select></label>
      {field("İşə qəbul əmrinin nömrəsi", "hireOrderNo")}
      {field("Əmrin tarixi", "hireOrderDate", { type: "date" })}
    </div></fieldset>
    <fieldset><legend>Məzuniyyət hüququ</legend><div className="hrgrid">
      <label className="field">Əvvəlki iş yerlərindəki staj{prior && <small> · iş yerlərindən avtomatik</small>}<span className="hrtriple">
        <Input value={prior ? String(prior.years) : form.priorYears} placeholder="il" {...digitsOnly("priorYears")} />
        <Input value={prior ? String(prior.months) : form.priorMonths} placeholder="ay" {...digitsOnly("priorMonths", 2)} />
        <Input value={prior ? String(prior.days) : form.priorDays} placeholder="gün" {...digitsOnly("priorDays", 2)} />
      </span></label>
      {field("Əsas məzuniyyət (gün)", "baseLeaveDays", { inputMode: "numeric", placeholder: `${params.baseLeaveDays} (ümumi qayda)` })}
      {field("Digər əlavə günlər", "extraLeaveDays", { inputMode: "numeric", placeholder: "0" })}
      {field("Əlavə günlərin səbəbi", "extraLeaveNote", { placeholder: "məs. 14 yaşadək 2 uşaq" })}
      {field("Başlanğıc qalığın tarixi", "openingBalanceDate", { type: "date" })}
      {field("Həmin tarixə qalıq (gün)", "openingBalanceDays", { inputMode: "decimal" })}
    </div><small className="hrhint">Staja görə əlavə günlər parametrlərə əsasən avtomatik hesablanır (əvvəlki stajın il və ayı nəzərə alınır). “Başlanğıc qalıq” köhnə məzuniyyət tarixçəsini daxil etmədən, sistemə köçürülən günə qalığı yazmaq üçündür; ondan əvvəlki məzuniyyətlər hesaba düşmür.</small></fieldset>
    {employee && <fieldset><legend>İşdən çıxma</legend><div className="hrgrid">
      {field("İşdən çıxma tarixi", "terminationDate", { type: "date" })}
      <label className="field hrwide">Əsas<select value={form.terminationReason} onChange={(e) => set("terminationReason")(e.target.value)}><option value="">—</option>{TERMINATION_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
    </div></fieldset>}
    <label className="field">Qeyd<Input value={form.note} onChange={(e) => set("note")(e.target.value)} /></label>
    {error && <div className="errorbox">{error}</div>}
    <div className="hractions">{employee && <button className="deletetaskbtn" disabled={busy} onClick={() => void remove()}>Kartı sil</button>}{!form.phone.trim() && <small className="hrwarn">Telefon nömrəsi məcburidir</small>}<Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? "Saxlanılır..." : employee ? "Dəyişiklikləri saxla" : "İşçini əlavə et"}</Button></div>
  </div>;
}

// ---------------------------------------------------------------- Ailə və təhsil
const ageOn = (birth: string | null, today: string) => {
  if (!birth || !isIsoDate(birth)) return null;
  let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  if (today.slice(5) < birth.slice(5)) age -= 1;
  return age;
};
const emptyFamily = (): Record<string, string> => ({ id: "", relation: "Oğlu", lastName: "", firstName: "", patronymic: "", birthDate: "", workplace: "", phone: "" });
const emptyEducation = (): Record<string, string> => ({ id: "", level: "Bakalavr", institution: "", specialty: "", startYear: "", endYear: "", diplomaNo: "", diplomaKey: "", diplomaName: "" });
function FamilyTab({ employee, data, call }: { employee: HrEmployee; data: HrData; call: Call }) {
  const today = todayIso();
  const [family, setFamily] = useState(emptyFamily);
  const [education, setEducation] = useState(emptyEducation);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const members = data.family.filter((f) => f.hr_employee_id === employee.id);
  const schools = data.education.filter((e) => e.hr_employee_id === employee.id);
  const under14 = members.filter((m) => (m.relation === "Oğlu" || m.relation === "Qızı") && (ageOn(m.birth_date, today) ?? 99) < 14).length;
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await work(); return true; } catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); return false; } finally { setBusy(""); }
  };
  const saveFamily = async () => { if (await run("family", () => call("POST", { action: "family", hrEmployeeId: employee.id, ...family }))) setFamily(emptyFamily()); };
  const saveEducation = async () => { if (await run("education", () => call("POST", { action: "education", hrEmployeeId: employee.id, ...education }))) setEducation(emptyEducation()); };
  const removeFamily = (m: HrFamily) => { if (window.confirm(`${m.relation} — ${m.first_name} qeydini silmək istəyirsiniz?`)) void run("family", () => call("DELETE", `type=family&id=${m.id}`)); };
  const removeEducation = (e: HrEducation) => { if (window.confirm(`${e.institution} qeydini silmək istəyirsiniz?`)) void run("education", () => call("DELETE", `type=education&id=${e.id}`)); };
  const uploadDiploma = (file: File | undefined) => {
    if (!file) return;
    void run("diploma", async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error("Diplom faylının həcmi 10 MB-dan çox ola bilməz.");
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/file", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fayl yüklənmədi.");
      setEducation((f) => ({ ...f, diplomaKey: result.key, diplomaName: result.name }));
    });
  };
  const fam = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFamily((f) => ({ ...f, [key]: e.target.value }));
  const edu = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setEducation((f) => ({ ...f, [key]: e.target.value }));
  const yearProps = (key: string) => ({ inputMode: "numeric" as const, placeholder: "il", value: education[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEducation((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, "").slice(0, 4) })) });
  return <div className="hrtab">
    <div className="hrgrid hrfamilytop">
      <label className="field">Ailə vəziyyəti<select value={employee.marital_status || ""} disabled={busy === "marital"} onChange={(e) => void run("marital", () => call("POST", { action: "marital", hrEmployeeId: employee.id, maritalStatus: e.target.value }))}><option value="">—</option>{MARITAL_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      {under14 > 0 && <small className="hrhint hrwarn hrwide">14 yaşadək {under14} uşaq. Bu, əlavə məzuniyyət günlərinə əsas ola bilər (qanuni şərtləri mühasiblə yoxlayın) — “Şəxsi kart” → “Digər əlavə günlər”.</small>}
    </div>
    <h4>{family.id ? "Ailə üzvünü redaktə et" : "Ailə üzvləri"}</h4>
    <div className="hrgrid">
      <label className="field">Qohumluq *<select value={family.relation} onChange={fam("relation")}>{FAMILY_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      <label className="field">Soyadı<Input value={family.lastName} onChange={fam("lastName")} /></label>
      <label className="field">Adı *<Input value={family.firstName} onChange={fam("firstName")} /></label>
      <label className="field">Ata adı<Input value={family.patronymic} onChange={fam("patronymic")} /></label>
      <label className="field">Doğum tarixi<Input type="date" value={family.birthDate} onChange={fam("birthDate")} /></label>
      <label className="field">İş və ya təhsil yeri<Input value={family.workplace} onChange={fam("workplace")} /></label>
      <label className="field">Telefon<Input inputMode="tel" placeholder="+994 50 123 45 67" value={family.phone} onChange={fam("phone")} /></label>
    </div>
    <div className="hractions">{family.id && <button className="inlinecancel" onClick={() => setFamily(emptyFamily())}>Ləğv et</button>}<Button disabled={Boolean(busy) || !family.firstName.trim()} onClick={() => void saveFamily()}>{busy === "family" ? "Saxlanılır..." : family.id ? "Yadda saxla" : "Ailə üzvünü əlavə et"}</Button></div>
    {members.length > 0 && <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Qohumluq</th><th>Soyadı, adı, ata adı</th><th>Doğum tarixi</th><th>Yaşı</th><th>İş / təhsil yeri</th><th>Telefon</th><th></th></tr></thead><tbody>
      {members.map((m) => <tr key={m.id}><td>{m.relation}</td><td>{[m.last_name, m.first_name, m.patronymic].filter(Boolean).join(" ")}</td><td>{m.birth_date ? formatDay(m.birth_date) : "—"}</td><td>{ageOn(m.birth_date, today) ?? "—"}</td><td>{m.workplace || "—"}</td><td>{m.phone || "—"}</td>
        <td><div className="tableactions"><button className="editcompanybtn" onClick={() => setFamily({ id: String(m.id), relation: m.relation, lastName: m.last_name || "", firstName: m.first_name, patronymic: m.patronymic || "", birthDate: m.birth_date || "", workplace: m.workplace || "", phone: m.phone || "" })}>Redaktə</button><button className="deletetaskbtn" onClick={() => removeFamily(m)}>Sil</button></div></td></tr>)}
    </tbody></table></div>}
    <h4>{education.id ? "Təhsil qeydini redaktə et" : "Təhsil"}</h4>
    <div className="hrgrid">
      <label className="field">Səviyyə *<select value={education.level} onChange={edu("level")}>{EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
      <label className="field hrwide">Təhsil müəssisəsi *<Input value={education.institution} onChange={edu("institution")} /></label>
      <label className="field">İxtisas<Input value={education.specialty} onChange={edu("specialty")} /></label>
      <label className="field">Təhsil illəri<span className="hrpair"><Input {...yearProps("startYear")} placeholder="başlama" /><Input {...yearProps("endYear")} placeholder="bitmə" /></span></label>
      <label className="field">Diplomun nömrəsi<Input value={education.diplomaNo} onChange={edu("diplomaNo")} /></label>
      <label className="field">Diplom (skan)<span className="hrscan"><Input type="file" accept="image/*,application/pdf" disabled={Boolean(busy)} onChange={(e) => uploadDiploma(e.target.files?.[0])} />
        {busy === "diploma" ? <small>Yüklənir...</small> : education.diplomaKey ? <small><a href={`/api/file?key=${encodeURIComponent(education.diplomaKey)}`} target="_blank" rel="noreferrer">{education.diplomaName || "Bax"}</a> · <button type="button" className="hrlink" onClick={() => setEducation((f) => ({ ...f, diplomaKey: "", diplomaName: "" }))}>götür</button></small> : null}</span></label>
    </div>
    <div className="hractions">{education.id && <button className="inlinecancel" onClick={() => setEducation(emptyEducation())}>Ləğv et</button>}<Button disabled={Boolean(busy) || !education.institution.trim()} onClick={() => void saveEducation()}>{busy === "education" ? "Saxlanılır..." : education.id ? "Yadda saxla" : "Təhsil qeydini əlavə et"}</Button></div>
    {schools.length > 0 && <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Səviyyə</th><th>Müəssisə</th><th>İxtisas</th><th>İllər</th><th>Diplom</th><th></th></tr></thead><tbody>
      {schools.map((e) => <tr key={e.id}><td>{e.level}</td><td>{e.institution}</td><td>{e.specialty || "—"}</td><td>{e.start_year || e.end_year ? `${e.start_year || "…"} – ${e.end_year || "…"}` : "—"}</td>
        <td>{e.diploma_no ? `№ ${e.diploma_no}` : ""}{e.diploma_key ? <>{e.diploma_no ? " · " : ""}<a href={`/api/file?key=${encodeURIComponent(e.diploma_key)}`} target="_blank" rel="noreferrer">skan</a></> : ""}{!e.diploma_no && !e.diploma_key ? "—" : ""}</td>
        <td><div className="tableactions"><button className="editcompanybtn" onClick={() => setEducation({ id: String(e.id), level: e.level, institution: e.institution, specialty: e.specialty || "", startYear: e.start_year ? String(e.start_year) : "", endYear: e.end_year ? String(e.end_year) : "", diplomaNo: e.diploma_no || "", diplomaKey: e.diploma_key || "", diplomaName: e.diploma_name || "" })}>Redaktə</button><button className="deletetaskbtn" onClick={() => removeEducation(e)}>Sil</button></div></td></tr>)}
    </tbody></table></div>}
    {error && <div className="errorbox">{error}</div>}
  </div>;
}

// ---------------------------------------------------------------- Müştərilər üzrə hesabat
type CustomerReportRow = { customer_id: number; hr_employee_id: number; last_name: string; first_name: string; patronymic: string | null; prior_position: string; start_date: string; end_date: string; prior_termination_reason: string | null; current_position: string | null; company_name: string | null; termination_date: string | null };
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
function CustomerReportSection({ data }: { data: HrData }) {
  const [rows, setRows] = useState<CustomerReportRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hr?report=customers").then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!cancelled) setRows(body.rows || []); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Hesabat açılmadı."); });
    return () => { cancelled = true; };
  }, []);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);
  const person = (r: CustomerReportRow) => [r.last_name, r.first_name, r.patronymic].filter(Boolean).join(" ");
  const q = query.trim().toLocaleLowerCase("az");
  const groups = [...(rows || []).filter((r) => !onlyActive || !r.termination_date).reduce((map, r) => map.set(r.customer_id, [...(map.get(r.customer_id) || []), r]), new Map<number, CustomerReportRow[]>()).entries()]
    .map(([id, list]) => ({ customer: customers.get(id), id, list }))
    .filter((g) => !q || `${g.customer?.name || ""} ${g.customer?.voen || ""} ${g.list.map(person).join(" ")}`.toLocaleLowerCase("az").includes(q))
    .sort((a, b) => b.list.length - a.list.length || (a.customer?.name || "").localeCompare(b.customer?.name || "", "az"));
  const now = (r: CustomerReportRow) => r.termination_date ? `İşdən çıxıb (${formatDay(r.termination_date)})` : [r.company_name, r.current_position].filter(Boolean).join(" · ") || "—";
  const exportCsv = () => {
    const header = ["Müştəri", "VÖEN", "İşçi", "Oradakı vəzifəsi", "Başlama", "Bitmə", "Staj", "Oradan çıxma əsası", "İndi bizdə"];
    const lines = groups.flatMap((g) => g.list.map((r) => [g.customer?.name || `#${g.id}`, g.customer?.voen || "", person(r), r.prior_position, formatDay(r.start_date), formatDay(r.end_date), serviceText(serviceParts(r.start_date, r.end_date)), r.prior_termination_reason ? reasonLabel(r.prior_termination_reason) : "", now(r)]));
    const csv = "\uFEFF" + [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `musteriler-uzre-hesabat-${todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const people = new Set(groups.flatMap((g) => g.list.map((r) => r.hr_employee_id))).size;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Müştərilər üzrə hesabat</h2><p>Müştərilərdə əvvəllər işləmiş əməkdaşlarımız · {groups.length} müştəri, {people} işçi</p></div><Button disabled={!groups.length} onClick={exportCsv}>Excel-ə yüklə (CSV)</Button></div>
    <div className="hrfilters">
      <label className="hrsearch">Axtarış<Input value={query} placeholder="Müştəri, VÖEN və ya işçi..." onChange={(e) => setQuery(e.target.value)} /></label>
      <label className="hrcheck"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />Yalnız hazırda işləyənlər</label>
    </div>
    {error ? <div className="errorbox">{error}</div> : !rows ? <div className="loading">Yüklənir...</div> : !groups.length ? <div className="empty"><p>{rows.length ? "Filtrə uyğun nəticə tapılmadı." : "Hələ heç bir işçinin kartında əvvəlki iş yeri qeyd olunmayıb."}</p></div>
      : <div className="tasktablewrap"><table className="tasktable hrtable"><thead><tr><th>İşçi</th><th>Oradakı vəzifəsi</th><th>Dövr</th><th>Staj</th><th>Oradan çıxma əsası</th><th>İndi bizdə</th></tr></thead>
        {groups.map((g) => <tbody key={g.id}><tr className="hrreportgroup"><td colSpan={6}><b>{g.customer?.name || `Müştəri #${g.id}`}</b>{g.customer?.voen && <small> · VÖEN {g.customer.voen}</small>}<em>{g.list.length} işçi</em></td></tr>
          {g.list.map((r, i) => <tr key={`${r.hr_employee_id}-${i}`}><td>{person(r)}</td><td>{r.prior_position}</td><td>{formatDay(r.start_date)} – {formatDay(r.end_date)}</td><td>{serviceText(serviceParts(r.start_date, r.end_date))}</td><td>{r.prior_termination_reason ? reasonLabel(r.prior_termination_reason) : "—"}</td><td className={r.termination_date ? "hrsub" : ""}>{now(r)}</td></tr>)}
        </tbody>)}</table></div>}
  </section>;
}

const emptyLeave = (): Record<string, string> => ({ id: "", kind: "annual", startDate: "", endDate: "", days: "", orderNo: "", orderDate: "", note: "" });
function LeavesTab({ employee, data, call }: { employee: HrEmployee; data: HrData; call: Call }) {
  const params = normalizeParams(data.params);
  const calendar = useMemo(() => indexCalendar(data.calendar), [data.calendar]);
  const [asOf, setAsOf] = useState(employee.termination_date || todayIso());
  const [form, setForm] = useState(emptyLeave);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const leaves = data.leaves.filter((l) => l.hr_employee_id === employee.id);
  const balance = leaveBalance(employee, leaves, params, isIsoDate(asOf) ? asOf : todayIso());
  const autoDays = form.kind === "annual" ? leaveDaysBetween(form.startDate, form.endDate, calendar, params) : isIsoDate(form.startDate) && isIsoDate(form.endDate) && form.endDate >= form.startDate ? Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86400000) + 1 : 0;
  const holidaysInside = form.kind === "annual" && isIsoDate(form.startDate) && isIsoDate(form.endDate) ? data.calendar.filter((d) => d.date >= form.startDate && d.date <= form.endDate && (d.kind === "holiday" || (d.kind === "dayoff" && params.excludeDayOffFromLeave))) : [];
  const save = async () => {
    setBusy(true); setError("");
    try { await call("POST", { action: "leave", hrEmployeeId: employee.id, ...form, days: form.days || autoDays }); setForm(emptyLeave()); }
    catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); } finally { setBusy(false); }
  };
  const remove = async (leave: HrLeave) => {
    if (!window.confirm(`${formatDay(leave.start_date)} – ${formatDay(leave.end_date)} məzuniyyətini silmək istəyirsiniz?`)) return;
    try { await call("DELETE", `type=leave&id=${leave.id}`); } catch (e) { setError(e instanceof Error ? e.message : "Silinmədi."); }
  };
  return <div className="hrtab">
    <div className="hrsummary">
      <label className="field">Qalıq hansı tarixə<Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      <span><small>Məzuniyyət qalığı</small><b className={balance.balance < 0 ? "hrneg" : "hrpos"}>{days(balance.balance)} gün</b></span>
      <span><small>Qazanılıb</small><b>{days(balance.earned)}</b></span>
      <span><small>İstifadə olunub</small><b>{days(balance.used)}</b></span>
      {balance.current && <span><small>Cari iş ili</small><b className="hrsmall">{formatDay(balance.current.start)} – {formatDay(balance.current.end)}</b><small>{balance.current.entitlement} gün hüquq · ümumi staj {balance.current.stageYears} il</small></span>}
    </div>
    <h4>{form.id ? "Məzuniyyəti redaktə et" : "Yeni məzuniyyət"}</h4>
    <div className="hrgrid hrleaveform">
      <label className="field">Növ<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{LEAVE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
      <label className="field">Başlama<Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
      <label className="field">Bitmə (son gün)<Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
      <label className="field">Gün sayı<Input inputMode="decimal" value={form.days} placeholder={autoDays ? `${autoDays} (təqvimə görə)` : ""} onChange={(e) => setForm({ ...form, days: e.target.value })} /></label>
      <label className="field">Əmr №<Input value={form.orderNo} onChange={(e) => setForm({ ...form, orderNo: e.target.value })} /></label>
      <label className="field">Əmrin tarixi<Input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} /></label>
      <label className="field hrwide">Qeyd<Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    </div>
    {holidaysInside.length > 0 && <small className="hrhint">Bu dövrə düşən {holidaysInside.length} bayram günü hesablanmır: {holidaysInside.map((d) => `${formatDay(d.date)}${d.name ? ` (${d.name})` : ""}`).join(", ")}.</small>}
    {form.kind === "unpaid" && params.unpaidExtendsWorkYear && <small className="hrhint">Ödənişsiz məzuniyyət günləri iş ilini uzadır (parametrlərdə dəyişmək olar).</small>}
    {error && <div className="errorbox">{error}</div>}
    <div className="hractions">{form.id && <button className="inlinecancel" onClick={() => setForm(emptyLeave())}>Ləğv et</button>}<Button disabled={busy || !form.startDate || !form.endDate} onClick={() => void save()}>{busy ? "Saxlanılır..." : form.id ? "Yadda saxla" : "Əlavə et"}</Button></div>
    <h4>Qeydə alınmış məzuniyyətlər</h4>
    <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Növ</th><th>Dövr</th><th>Gün</th><th>Əmr</th><th>Qeyd</th><th></th></tr></thead><tbody>
      {leaves.map((l) => <tr key={l.id}><td>{leaveKindLabel(l.kind)}</td><td>{formatDay(l.start_date)} – {formatDay(l.end_date)}</td><td>{days(Number(l.days))}</td><td>{l.order_no ? `№ ${l.order_no}` : "—"}{l.order_date && <small className="hrsub">{formatDay(l.order_date)}</small>}</td><td>{l.note || "—"}</td>
        <td><div className="tableactions"><button className="editcompanybtn" onClick={() => setForm({ id: String(l.id), kind: l.kind, startDate: l.start_date, endDate: l.end_date, days: String(l.days), orderNo: l.order_no || "", orderDate: l.order_date || "", note: l.note || "" })}>Redaktə</button><button className="deletetaskbtn" onClick={() => void remove(l)}>Sil</button></div></td></tr>)}
    </tbody></table>{!leaves.length && <div className="empty"><p>Hələ məzuniyyət qeydə alınmayıb.</p></div>}</div>
    <h4>Qalığın hesablanması ({formatDay(balance.asOf)} tarixinə)</h4>
    <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Tarix</th><th>Əməliyyat</th><th>+ gün</th><th>− gün</th><th>Qalıq</th></tr></thead><tbody>
      {balance.ledger.map((r, i) => <tr key={i}><td>{formatDay(r.date)}</td><td>{r.label}</td><td>{r.plus ? days(r.plus) : ""}</td><td>{r.minus ? days(r.minus) : ""}</td><td><b className={r.balance < 0 ? "hrneg" : ""}>{days(r.balance)}</b></td></tr>)}
    </tbody></table></div>
  </div>;
}

function SalaryTab({ employee, data, call }: { employee: HrEmployee; data: HrData; call: Call }) {
  const params = normalizeParams(data.params);
  const salaries = data.salaries.filter((s) => s.hr_employee_id === employee.id);
  const byPeriod = new Map(salaries.map((s) => [s.period, s.amount]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reference = employee.termination_date || todayIso();
  const average = averageEarnings(salaries, reference, params);
  const periods: string[] = [];
  for (let i = 1; i <= 24; i++) { const p = addMonths(monthStart(reference), -i + 1).slice(0, 7); if (p < employee.hire_date.slice(0, 7)) break; periods.push(p); }
  const counted = new Set(average.rows.map((r) => r.period));
  const commit = async (period: string) => {
    const value = drafts[period];
    if (value === undefined || value === String(byPeriod.get(period) ?? "")) return;
    setError("");
    try { await call("POST", { action: "salary", hrEmployeeId: employee.id, period, amount: value }); setDrafts((d) => { const next = { ...d }; delete next[period]; return next; }); }
    catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); }
  };
  const fill = async () => {
    setBusy(true); setError("");
    try { await call("POST", { action: "salary-fill", hrEmployeeId: employee.id, months: params.avgMonths }); } catch (e) { setError(e instanceof Error ? e.message : "Doldurulmadı."); } finally { setBusy(false); }
  };
  return <div className="hrtab">
    <div className="hrsummary">
      <span><small>Vəzifə maaşı</small><b>{employee.monthly_salary ? money(employee.monthly_salary) : "—"}</b></span>
      <span><small>Orta aylıq ({average.months} ay üzrə)</small><b>{money(average.monthly)}</b></span>
      <span><small>Orta günlük (÷ {params.avgDivisor})</small><b>{money(average.daily)}</b></span>
      <span><small>Son {params.avgMonths} ayın cəmi</small><b>{money(average.total)}</b></span>
    </div>
    <small className="hrhint">Hər ay üçün işçiyə hesablanmış əmək haqqını yazın (orta əmək haqqına daxil olan ödənişlər). Orta əmək haqqı {formatDay(reference)} tarixindən əvvəlki {params.avgMonths} ay üzrə hesablanır; məbləğ yazılmayan aylar nəzərə alınmır. Dəyişiklik xanadan çıxanda saxlanılır.</small>
    <div className="hractions left"><Button variant="outline" disabled={busy || !employee.monthly_salary} onClick={() => void fill()}>Boş ayları vəzifə maaşı ilə doldur (son {params.avgMonths} ay)</Button></div>
    {error && <div className="errorbox">{error}</div>}
    <div className="hrsalarygrid">{periods.map((p) => <label key={p} className={`field${counted.has(p) ? " counted" : ""}`}>{periodLabel(p)}{counted.has(p) && <small>ortaya daxildir</small>}
      <Input inputMode="decimal" value={drafts[p] ?? String(byPeriod.get(p) ?? "")} onChange={(e) => setDrafts((d) => ({ ...d, [p]: e.target.value }))} onBlur={() => void commit(p)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>)}</div>
  </div>;
}

function SettlementTab({ employee, data, call }: { employee: HrEmployee; data: HrData; call: Call }) {
  const params = normalizeParams(data.params);
  const calendar = useMemo(() => indexCalendar(data.calendar), [data.calendar]);
  const initialReason = employee.termination_reason && TERMINATION_REASONS.some((r) => r.key === employee.termination_reason) ? employee.termination_reason : "own";
  const [date, setDate] = useState(employee.termination_date || todayIso());
  const [reasonKey, setReasonKey] = useState(initialReason);
  const [severance, setSeverance] = useState(Boolean(TERMINATION_REASONS.find((r) => r.key === initialReason)?.severance));
  const [worked, setWorked] = useState("");
  const [deduct, setDeduct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const leaves = data.leaves.filter((l) => l.hr_employee_id === employee.id);
  const salaries = data.salaries.filter((s) => s.hr_employee_id === employee.id);
  const valid = isIsoDate(date) && date >= employee.hire_date;
  const result = valid ? settlement(employee, leaves, salaries, calendar, params, { date, reasonKey, severance, workedDays: worked.trim() === "" ? null : Number(worked), deductOverused: deduct }) : null;
  const lines = result ? [
    { label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ayı üçün əmək haqqı`, detail: `${employee.monthly_salary ? money(employee.monthly_salary) : "vəzifə maaşı yoxdur"} × ${result.workedDays} işlənmiş gün / ${result.norm.days} iş günü (norma)`, amount: result.salaryPart },
    { label: "İstifadə olunmamış məzuniyyətə görə kompensasiya", detail: `${days(result.compensationDays)} gün × ${money(result.average.daily)} (orta günlük)`, amount: result.compensation },
    ...(severance ? [{ label: "İşdən çıxma müavinəti", detail: `${result.severanceMultiplier} × ${money(result.average.monthly)} (orta aylıq), bu firmada staj ${result.serviceYears} il`, amount: result.severance }] : []),
    ...(result.overusedDays > 0 ? [{ label: "Artıq istifadə olunmuş məzuniyyətə görə tutulma", detail: deduct ? `${days(result.overusedDays)} gün × ${money(result.average.daily)}` : `${days(result.overusedDays)} gün artıq istifadə olunub — tutulma seçilməyib`, amount: -result.overusedDeduction }] : []),
  ] : [];
  const markTerminated = async () => {
    if (!window.confirm(`${fullName(employee)} üçün işdən çıxma tarixi ${formatDay(date)} və əsas “${reasonLabel(reasonKey)}” karta yazılsın?`)) return;
    setBusy(true); setError(""); setSaved("");
    try { await call("POST", { ...toPayload(toForm(employee), toJobRows(employee, data.priorJobs)), terminationDate: date, terminationReason: reasonKey }); setSaved("İşdən çıxma karta yazıldı."); }
    catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); } finally { setBusy(false); }
  };
  const print = () => {
    if (!result) return;
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return;
    const rows = lines.map((l) => `<tr><td><b>${escapeHtml(l.label)}</b><br><small>${escapeHtml(l.detail)}</small></td><td class="n">${escapeHtml(money(l.amount))}</td></tr>`).join("");
    const avgRows = result.average.rows.map((r) => `<tr><td>${escapeHtml(periodLabel(r.period))}</td><td class="n">${r.amount ? escapeHtml(money(r.amount)) : "—"}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Son hesablaşma — ${escapeHtml(fullName(employee))}</title><style>body{font:13px/1.45 Arial,sans-serif;color:#111;margin:32px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}small{color:#555}.total td{font-weight:bold;font-size:14px}.meta td{border:0;padding:2px 8px 2px 0}.note{color:#555;font-size:11px;margin-top:18px}</style></head><body>
      <h1>İşdən çıxma ilə əlaqədar son hesablaşma</h1>
      <table class="meta"><tr><td>İşçi:</td><td><b>${escapeHtml(fullName(employee))}</b>${employee.fin ? ` (FİN ${escapeHtml(employee.fin)})` : ""}</td></tr><tr><td>Firma / vəzifə:</td><td>${escapeHtml([employee.company_name, employee.department, employee.position].filter(Boolean).join(", ") || "—")}</td></tr><tr><td>İşə qəbul:</td><td>${formatDay(employee.hire_date)}</td></tr><tr><td>İşdən çıxma:</td><td>${formatDay(date)} — ${escapeHtml(reasonLabel(reasonKey))}</td></tr><tr><td>Məzuniyyət qalığı:</td><td>${escapeHtml(days(result.balance.balance))} gün</td></tr></table>
      <h2>Hesablama</h2><table>${rows}<tr class="total"><td>Cəmi hesablanıb</td><td class="n">${escapeHtml(money(result.total))}</td></tr></table>
      <h2>Orta əmək haqqı (${result.average.months} ay, cəmi ${escapeHtml(money(result.average.total))}, orta aylıq ${escapeHtml(money(result.average.monthly))}, orta günlük ${escapeHtml(money(result.average.daily))})</h2><table>${avgRows}</table>
      <p class="note">Məbləğlər vergi və məcburi sosial sığorta tutulmalarından əvvəl göstərilib. Hazırlanma tarixi: ${formatDay(todayIso())}.</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };
  return <div className="hrtab">
    <div className="hrgrid">
      <label className="field">İşdən çıxma tarixi (son iş günü)<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="field hrwide">Əsas<select value={reasonKey} onChange={(e) => { setReasonKey(e.target.value); setSeverance(Boolean(TERMINATION_REASONS.find((r) => r.key === e.target.value)?.severance)); }}>{TERMINATION_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="field">Son ayda işlənmiş günlər<Input inputMode="numeric" value={worked} placeholder={result ? `${settlement(employee, leaves, salaries, calendar, params, { date, reasonKey, severance, workedDays: null, deductOverused: deduct }).workedDays} (təqvimə görə)` : ""} onChange={(e) => setWorked(e.target.value.replace(/[^\d.]/g, ""))} /></label>
      <label className="hrcheck"><input type="checkbox" checked={severance} onChange={(e) => setSeverance(e.target.checked)} />İşdən çıxma müavinəti hesablansın</label>
      <label className="hrcheck"><input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />Artıq istifadə olunmuş məzuniyyət tutulsun</label>
    </div>
    {!valid && <div className="errorbox">Tarix işə qəbul tarixindən ({formatDay(employee.hire_date)}) əvvəl ola bilməz.</div>}
    {result && <>
      <div className="hrsummary">
        <span><small>Məzuniyyət qalığı</small><b className={result.balance.balance < 0 ? "hrneg" : "hrpos"}>{days(result.balance.balance)} gün</b></span>
        <span><small>Orta aylıq ({result.average.months} ay)</small><b>{money(result.average.monthly)}</b></span>
        <span><small>Orta günlük</small><b>{money(result.average.daily)}</b></span>
        <span className="hrtotal"><small>Cəmi hesablanıb</small><b>{money(result.total)}</b></span>
      </div>
      {result.average.months < params.avgMonths && <small className="hrhint hrwarn">Diqqət: orta əmək haqqı {params.avgMonths} ay əvəzinə {result.average.months} ay üzrə hesablanıb — “Əmək haqqı” tabında aylıq məbləğləri yoxlayın.</small>}
      <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Ödəniş</th><th>Necə hesablanıb</th><th>Məbləğ</th></tr></thead><tbody>
        {lines.map((l) => <tr key={l.label}><td><b>{l.label}</b></td><td>{l.detail}</td><td className="hrnum">{money(l.amount)}</td></tr>)}
        <tr className="hrtotalrow"><td colSpan={2}>Cəmi (vergi və sosial sığorta tutulmalarından əvvəl)</td><td className="hrnum">{money(result.total)}</td></tr>
      </tbody></table></div>
    </>}
    {error && <div className="errorbox">{error}</div>}
    {saved && <div className="hrok">{saved}</div>}
    <div className="hractions"><Button variant="outline" disabled={!result} onClick={print}><Printer />Çap et</Button><Button disabled={busy || !valid || (employee.termination_date === date && employee.termination_reason === reasonKey)} onClick={() => void markTerminated()}>{busy ? "Saxlanılır..." : "İşdən çıxmanı karta yaz"}</Button></div>
  </div>;
}

// ---------------------------------------------------------------- İstehsalat təqvimi
function CalendarSection({ data, call }: { data: HrData; call: Call }) {
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [form, setForm] = useState<{ date: string; kind: CalendarKind; name: string }>({ date: "", kind: "holiday", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = normalizeParams(data.params);
  const calendar = useMemo(() => indexCalendar(data.calendar), [data.calendar]);
  const special = data.calendar.filter((d) => d.date.startsWith(`${year}-`));
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Əməliyyat baş tutmadı."); } finally { setBusy(false); } };
  const kindLabel = (kind: string) => CALENDAR_KINDS.find((k) => k.key === kind)?.label || kind;
  const months = MONTHS.map((name, i) => {
    const first = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    const last = monthEnd(first);
    return { name, first, five: workNorm(first, last, calendar, 5, params.dailyHours), six: workNorm(first, last, calendar, 6, params.dailyHours) };
  });
  const total = months.reduce((acc, m) => ({ d5: acc.d5 + m.five.days, h5: acc.h5 + m.five.hours, d6: acc.d6 + m.six.days }), { d5: 0, h5: 0, d6: 0 });
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>İstehsalat təqvimi</h2><p>Bayram, köçürülmüş istirahət və qısaldılmış günlər — məzuniyyət günlərinin və iş günü normasının hesablanması bunlara əsaslanır</p></div>
      <div className="hryear"><button onClick={() => setYear(year - 1)}>‹</button><b>{year}</b><button onClick={() => setYear(year + 1)}>›</button></div></div>
    <small className="hrhint hrpad">Nazirlər Kabineti hər il istirahət günlərinin köçürülməsini ayrıca elan edir, Ramazan və Qurban bayramlarının tarixləri də hər il dəyişir. “Standart bayramları əlavə et” sabit bayramları (və məlum olan illər üçün dini bayramları) əlavə edir — siyahını rəsmi qərarla yoxlayın, köçürülmüş günləri özünüz əlavə edin.</small>
    <div className="hrgrid hrpad hrcalform">
      <label className="field">Tarix<Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
      <label className="field">Günün növü<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarKind })}>{CALENDAR_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
      <label className="field hrwide">Adı / əsas<Input value={form.name} placeholder="məs. Novruz bayramı; NK-nın qərarı" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <div className="hractions"><Button disabled={busy || !form.date} onClick={() => void run(async () => { await call("POST", { action: "calendar-day", ...form }); setForm({ date: "", kind: form.kind, name: "" }); })}>Əlavə et</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => call("POST", { action: "calendar-seed", year }))}>Standart bayramları əlavə et ({year})</Button></div>
    </div>
    {error && <div className="errorbox">{error}</div>}
    <div className="hrcalendarcols">
      <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Tarix</th><th>Gün</th><th>Növ</th><th>Adı</th><th></th></tr></thead><tbody>
        {special.map((d) => <tr key={d.date}><td>{formatDay(d.date)}</td><td>{WEEKDAYS[weekday(d.date) - 1]}</td><td><span className={`hrkind ${d.kind}`}>{kindLabel(d.kind)}</span></td><td>{d.name || "—"}</td>
          <td><div className="tableactions"><button className="editcompanybtn" onClick={() => setForm({ date: d.date, kind: d.kind, name: d.name || "" })}>Redaktə</button><button className="deletetaskbtn" disabled={busy} onClick={() => void run(() => call("DELETE", `type=calendar&date=${d.date}`))}>Sil</button></div></td></tr>)}
      </tbody></table>{!special.length && <div className="empty"><p>{year} ili üçün xüsusi gün daxil edilməyib.</p></div>}</div>
      <div className="tasktablewrap"><table className="tasktable hrtable hrcompact"><thead><tr><th>Ay</th><th>İş günü (5 günlük)</th><th>İş saatı (5 günlük)</th><th>İş günü (6 günlük)</th></tr></thead><tbody>
        {months.map((m) => <tr key={m.name}><td>{m.name}</td><td>{m.five.days}</td><td>{m.five.hours}</td><td>{m.six.days}</td></tr>)}
        <tr className="hrtotalrow"><td>Cəmi</td><td>{total.d5}</td><td>{round2(total.h5)}</td><td>{total.d6}</td></tr>
      </tbody></table></div>
    </div>
    <div className="hrmonths">{months.map((m) => <MonthGrid key={m.name} first={m.first} name={m.name} calendar={calendar} />)}</div>
  </section>;
}

function MonthGrid({ first, name, calendar }: { first: string; name: string; calendar: ReturnType<typeof indexCalendar> }) {
  const last = monthEnd(first);
  const cells: (string | null)[] = Array.from({ length: weekday(first) - 1 }, () => null);
  for (let d = first; d <= last; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) cells.push(d);
  return <div className="hrmonth"><b>{name}</b><div className="hrmonthgrid">{WEEKDAYS.map((w) => <i key={w}>{w.slice(0, 2)}</i>)}
    {cells.map((d, i) => { if (!d) return <span key={`e${i}`} />; const s = calendar.get(d); const weekend = weekday(d) >= 6; return <span key={d} title={s ? `${CALENDAR_KINDS.find((k) => k.key === s.kind)?.label}${s.name ? ` — ${s.name}` : ""}` : undefined} className={s ? `hrday ${s.kind}` : weekend ? "hrday weekend" : "hrday"}>{Number(d.slice(8))}</span>; })}
  </div></div>;
}

// ---------------------------------------------------------------- Parametrlər
const stepsText = <T extends { years: number }>(steps: T[], key: keyof T) => steps.map((s) => `${s.years}:${s[key]}`).join(", ");
const parseSteps = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => { const [a, b] = part.split(":").map((x) => Number(x.trim().replace(",", "."))); return [a, b] as const; });

function SettingsSection({ data, call }: { data: HrData; call: Call }) {
  const initial = normalizeParams(data.params);
  const [form, setForm] = useState(() => ({
    baseLeaveDays: String(initial.baseLeaveDays), stageSteps: stepsText(initial.stageSteps, "days"), avgMonths: String(initial.avgMonths), avgDivisor: String(initial.avgDivisor),
    roundHalfMonth: initial.roundHalfMonth, unpaidExtendsWorkYear: initial.unpaidExtendsWorkYear, excludeDayOffFromLeave: initial.excludeDayOffFromLeave,
    severanceSteps: stepsText(initial.severanceSteps, "multiplier"), dailyHours: String(initial.dailyHours),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const stage = parseSteps(form.stageSteps), sev = parseSteps(form.severanceSteps);
  const stepsValid = [...stage, ...sev].every(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const save = async () => {
    setBusy(true); setError(""); setSaved(false);
    try {
      await call("POST", { action: "params", params: {
        baseLeaveDays: Number(form.baseLeaveDays), stageSteps: stage.map(([years, days]) => ({ years, days })), avgMonths: Number(form.avgMonths), avgDivisor: Number(form.avgDivisor.replace(",", ".")),
        roundHalfMonth: form.roundHalfMonth, unpaidExtendsWorkYear: form.unpaidExtendsWorkYear, excludeDayOffFromLeave: form.excludeDayOffFromLeave,
        severanceSteps: sev.map(([years, multiplier]) => ({ years, multiplier })), dailyHours: Number(form.dailyHours.replace(",", ".")),
      } });
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Saxlanmadı."); } finally { setBusy(false); }
  };
  const check = (key: "roundHalfMonth" | "unpaidExtendsWorkYear" | "excludeDayOffFromLeave", label: string) => <label className="hrcheck"><input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{label}</label>;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">KADR UÇOTU</span><h2>Hesablama parametrləri</h2><p>Bütün firmalar üçün ümumi qaydalar. Qanunvericilik dəyişəndə buradan yeniləyin.</p></div></div>
    <div className="hrcard hrpad">
      <small className="hrhint hrwarn">İlkin dəyərlər Əmək Məcəlləsinin ümumi qaydalarına əsasən doldurulub. İstifadəyə başlamazdan əvvəl mühasiblə yoxlayın.</small>
      <fieldset><legend>Məzuniyyət</legend><div className="hrgrid">
        <label className="field">Əsas məzuniyyət (təqvim günü)<Input inputMode="numeric" value={form.baseLeaveDays} onChange={(e) => setForm({ ...form, baseLeaveDays: e.target.value })} /></label>
        <label className="field hrwide">Staja görə əlavə günlər (il:gün, vergüllə)<Input value={form.stageSteps} onChange={(e) => setForm({ ...form, stageSteps: e.target.value })} /><small>məs. “5:2, 10:4, 15:6” — ümumi staj 5 ildən çox olduqda 2 gün, 10 ildən 4, 15 ildən 6</small></label>
        {check("roundHalfMonth", "Natamam iş ilində 15 gün və çox işlənmiş ay tam ay sayılsın")}
        {check("unpaidExtendsWorkYear", "Ödənişsiz məzuniyyət günləri iş ilini uzatsın")}
        {check("excludeDayOffFromLeave", "Köçürülmüş istirahət günləri də məzuniyyət müddətinə daxil edilməsin (bayram günləri həmişə çıxılır)")}
      </div></fieldset>
      <fieldset><legend>Orta əmək haqqı və müavinət</legend><div className="hrgrid">
        <label className="field">Orta əmək haqqı neçə ay üzrə<Input inputMode="numeric" value={form.avgMonths} onChange={(e) => setForm({ ...form, avgMonths: e.target.value })} /></label>
        <label className="field">Orta günlük üçün bölən<Input inputMode="decimal" value={form.avgDivisor} onChange={(e) => setForm({ ...form, avgDivisor: e.target.value })} /><small>ayın orta təqvim günü (30,4)</small></label>
        <label className="field">Gündəlik iş saatı (5 günlük həftə)<Input inputMode="decimal" value={form.dailyHours} onChange={(e) => setForm({ ...form, dailyHours: e.target.value })} /></label>
        <label className="field hrwide">İşdən çıxma müavinəti (bu firmada staj il:orta aylığın misli)<Input value={form.severanceSteps} onChange={(e) => setForm({ ...form, severanceSteps: e.target.value })} /><small>məs. “0:1, 1:1.4, 5:1.7, 10:2”. Müavinət yalnız ləğv və ixtisar əsaslarında avtomatik seçilir; hesablaşmada əl ilə də açmaq olar.</small></label>
      </div></fieldset>
      {!stepsValid && <div className="errorbox">Pilləli dəyərləri “il:dəyər” formatında, vergüllə ayıraraq yazın.</div>}
      {error && <div className="errorbox">{error}</div>}
      {saved && <div className="hrok">Parametrlər saxlanıldı.</div>}
      <div className="hractions"><Button disabled={busy || !stepsValid} onClick={() => void save()}>{busy ? "Saxlanılır..." : "Parametrləri saxla"}</Button></div>
    </div>
  </section>;
}

