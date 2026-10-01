"use client";

import { useEffect, useState } from "react";

// Versiya 2.62: clicking a parent menu item (Tapşırıqlar, Sənədlər, HR) opens its sub-menu and shows this overview instead of
// jumping into the first sub-section — one card per sub-section the user can open, with what is waiting there.

export type OverviewStat = { label: string; value: number | null; alert?: boolean };
// groups (Versiya 2.75): small breakdowns inside a card (e.g. late documents by department); each row opens its own slice.
export type OverviewGroup = { title: string; rows: Array<{ label: string; value: number; onOpen: () => void }> };
export type OverviewCard = { key: string; title: string; text: string; stats?: OverviewStat[]; groups?: OverviewGroup[]; wide?: boolean; onOpen: () => void };

export function SectionOverview({ cards, loading }: { cards: OverviewCard[]; loading?: boolean }) {
  if (!cards.length) return null;
  return <div className="overviewgrid">{cards.map((card) => <div key={card.key} role="button" tabIndex={0} className={card.wide ? "overviewcard wide" : "overviewcard"} onClick={card.onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.onOpen(); } }}>
    <b>{card.title}</b>
    <small>{card.text}</small>
    {card.stats && card.stats.length > 0 && <div className="overviewstats">{card.stats.map((s) => <span key={s.label} className={s.alert && s.value ? "alert" : ""}>
      <strong>{loading || s.value === null ? "…" : s.value}</strong>{s.label}
    </span>)}</div>}
    {card.groups && card.groups.some((g) => g.rows.length) && <div className="overviewgroups">{card.groups.filter((g) => g.rows.length).map((g) => <div key={g.title} className="overviewgroup">
      <small>{g.title}</small>
      {g.rows.map((r) => <button key={r.label} type="button" onClick={(e) => { e.stopPropagation(); r.onOpen(); }}><span>{r.label}</span><strong>{r.value}</strong></button>)}
    </div>)}</div>}
    <i>Aç →</i>
  </div>)}</div>;
}

type Approval = { canFinal: boolean; departments: Array<{ canApprove: boolean }> } | undefined;
const approvalActionable = (a: Approval) => Boolean(a && (a.canFinal || a.departments.some((d) => d.canApprove)));
const waitsForDirector = (status: string) => status === "Rəhbərin baxışında" || status === "Rəhbərdə";

// Versiya 2.75: an outgoing document whose signed copy is past its return date (same rule as the Çıxan sənədlər table).
type OutgoingRow = { company_id: number | null; final_key: string | null; final_name?: string | null; final_path?: string | null; returns_signed_copy?: number; return_due_date?: string | null; related_departments?: string[]; sending_department?: string | null; responsible_name?: string | null; delivered_by?: string | null; approval?: Approval };
function isOverdue(item: OutgoingRow) {
  if (item.returns_signed_copy === 0 || !item.return_due_date || item.final_name || item.final_path || item.final_key) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());
  return item.return_due_date < today;
}
const topGroups = (rows: string[], open: (label: string) => void) => {
  const counts = new Map<string, number>();
  rows.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "az")).slice(0, 6).map(([label, value]) => ({ label, value, onOpen: () => open(label) }));
};

export function DocumentsOverview({ showTemplates, showOutgoing, showIncoming, showCustomers, onOpenCustomers, openOverdue, activeCompanyId, open }: {
  showTemplates: boolean; showOutgoing: boolean; showIncoming: boolean; showCustomers: boolean; onOpenCustomers: () => void; activeCompanyId: number | null;
  openOverdue: (filter: { department?: string; responsible?: string }) => void;
  open: (tab: "templates" | "outgoing" | "incoming") => void;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [overdue, setOverdue] = useState<OutgoingRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const get = (url: string, on: boolean): Promise<Record<string, unknown>> => on ? fetch(url).then((r) => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({});
    void Promise.all([get("/api/documents", showTemplates), get("/api/documents/outgoing", showOutgoing), get("/api/documents/incoming", showIncoming), get("/api/customers", showCustomers)]).then(([tpl, out, inc, cus]) => {
      if (cancelled) return;
      const inScope = (companyId: number | null) => !activeCompanyId || companyId === activeCompanyId;
      const outgoing = ((out.items || []) as OutgoingRow[]).filter((i) => inScope(i.company_id));
      setOverdue(outgoing.filter(isOverdue));
      const incoming = ((inc.items || []) as Array<{ company_id: number; status: string; approval?: Approval }>).filter((i) => inScope(i.company_id));
      const directorOf = (inc.directorOf || []) as number[];
      setCounts({
        templates: ((tpl.items || []) as unknown[]).length, customers: ((cus.items || []) as unknown[]).length,
        outgoing: outgoing.length, outgoingNoFinal: outgoing.filter((i) => !i.final_key).length, outgoingApproval: outgoing.filter((i) => approvalActionable(i.approval)).length,
        incoming: incoming.length, incomingDirector: incoming.filter((i) => waitsForDirector(i.status) && directorOf.includes(i.company_id)).length,
        incomingApproval: incoming.filter((i) => approvalActionable(i.approval)).length, isDirector: directorOf.length,
      });
    });
    return () => { cancelled = true; };
  }, [showTemplates, showOutgoing, showIncoming, showCustomers, activeCompanyId]);
  const n = (key: string) => counts ? counts[key] ?? 0 : null;
  const cards: OverviewCard[] = [];
  if (showIncoming) cards.push({ key: "incoming", title: "Daxil olan sənədlər", text: "Daxil olan sənədlərin qeydiyyatı, rəhbərin baxışı, tapşırıqlar və təsdiq.", onOpen: () => open("incoming"), stats: [
    { label: "sənəd", value: n("incoming") },
    ...(counts?.isDirector ? [{ label: "rəhbərin baxışında", value: n("incomingDirector"), alert: true }] : []),
    { label: "təsdiqimi gözləyir", value: n("incomingApproval"), alert: true },
  ] });
  // Late signed copies: the admin and the director see all of the firm, a department its own — the same documents the user
  // sees in Çıxan sənədlər. The card opens "Yubananlar"; a department or a person opens just theirs.
  if (showOutgoing) cards.push({ key: "overdue", wide: true, title: "Yubanan sənədlər", text: "İmzalı nüsxəsi qaytarılma müddətində geri gəlməyən çıxan sənədlər.", onOpen: () => openOverdue({}),
    stats: [{ label: "yubanır", value: counts ? overdue.length : null, alert: true }],
    groups: [
      { title: "Şöbələr üzrə", rows: topGroups(overdue.map((i) => (i.related_departments || [])[0] || i.sending_department || "Şöbə göstərilməyib"), (department) => openOverdue({ department })) },
      { title: "Məsul şəxslər üzrə", rows: topGroups(overdue.map((i) => i.responsible_name || i.delivered_by || "Məsul göstərilməyib"), (responsible) => openOverdue({ responsible })) },
    ] });
  if (showOutgoing) cards.push({ key: "outgoing", title: "Çıxan sənədlər", text: "Göndərilən sənədlərin qeydiyyatı, hazır sənəd və təsdiq.", onOpen: () => open("outgoing"), stats: [
    { label: "sənəd", value: n("outgoing") },
    { label: "hazır sənəd yüklənməyib", value: n("outgoingNoFinal"), alert: true },
    { label: "təsdiqimi gözləyir", value: n("outgoingApproval"), alert: true },
  ] });
  // Versiya 2.74: Müştərilər — the other side of the documents — sits here, before Şablonlar.
  if (showCustomers) cards.push({ key: "customers", title: "Müştərilər", text: "Müştəri və təşkilat kartları (VÖEN, ünvan, telefon).", onOpen: onOpenCustomers, stats: [{ label: "müştəri", value: n("customers") }] });
  if (showTemplates) cards.push({ key: "templates", title: "Şablonlar", text: "Sənəd növləri, şablon faylları, papka və ad qaydaları.", onOpen: () => open("templates"), stats: [{ label: "şablon", value: n("templates") }] });
  return <SectionOverview cards={cards} loading={!counts}/>;
}

type HrTab = "violations" | "orders" | "personnel" | "customers" | "calendar" | "settings";
export function HrOverview({ showViolations, showPersonnel, showOrders, activeCompanyId, open }: {
  showViolations: boolean; showPersonnel: boolean; showOrders: boolean; activeCompanyId: number | null; open: (tab: HrTab) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const get = (url: string, on: boolean): Promise<Record<string, unknown>> => on ? fetch(url).then((r) => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({});
    void Promise.all([get("/api/violations", showViolations), get("/api/hr", showPersonnel), get("/api/hr/orders", showOrders)]).then(([vio, hr, ord]) => {
      if (cancelled) return;
      const inScope = (companyId: number | null) => !activeCompanyId || companyId === activeCompanyId;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const violations = ((vio.items || []) as Array<{ company_id: number | null; created_at: string }>).filter((v) => inScope(v.company_id));
      const workers = ((hr.employees || []) as Array<{ company_id: number | null; termination_date: string | null }>).filter((e) => inScope(e.company_id));
      const orders = ((ord.orders || []) as Array<{ company_id: number | null; status: string }>).filter((o) => inScope(o.company_id));
      setCounts({
        violationsMonth: violations.filter((v) => new Date(v.created_at) >= monthStart).length, violations: violations.length,
        working: workers.filter((e) => !e.termination_date).length,
        orders: orders.length, ordersPending: orders.filter((o) => o.status === "pending").length,
      });
    });
    return () => { cancelled = true; };
  }, [showViolations, showPersonnel, showOrders, activeCompanyId]);
  const n = (key: string) => counts ? counts[key] ?? 0 : null;
  const cards: OverviewCard[] = [];
  if (showViolations) cards.push({ key: "violations", title: "Nöqsanlar", text: "İşçilər üzrə qeydə alınmış nöqsanlar.", onOpen: () => open("violations"), stats: [
    { label: "bu ay", value: n("violationsMonth"), alert: true }, { label: "cəmi", value: n("violations") },
  ] });
  if (showPersonnel) {
    cards.push({ key: "personnel", title: "Personallar", text: "İşçi kartları, məzuniyyət qalığı, son hesablaşma.", onOpen: () => open("personnel"), stats: [{ label: "işləyən", value: n("working") }] });
    cards.push({ key: "customers", title: "Əvvəlki iş yerləri", text: "İşçilərin əvvəlki iş yerləri müştərilər üzrə.", onOpen: () => open("customers") });
    cards.push({ key: "calendar", title: "İstehsalat təqvimi", text: "Bayram, qeyri-iş və köçürülən günlər.", onOpen: () => open("calendar") });
    cards.push({ key: "settings", title: "Hesablama parametrləri", text: "Məzuniyyət və hesablaşma qaydaları, hüquqi əsaslar.", onOpen: () => open("settings") });
  }
  if (showOrders) cards.push({ key: "orders", title: "Əmrlər", text: "Məzuniyyət, işdən çıxma və digər əmrlər.", onOpen: () => open("orders"), stats: [
    { label: "imzalı nüsxə gözləyir", value: n("ordersPending"), alert: true }, { label: "cəmi", value: n("orders") },
  ] });
  // Same order as the menu (Versiya 2.71): daily work first, settings-like sections last.
  const order = ["personnel", "orders", "violations", "customers", "calendar", "settings"];
  cards.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return <SectionOverview cards={cards} loading={!counts}/>;
}
