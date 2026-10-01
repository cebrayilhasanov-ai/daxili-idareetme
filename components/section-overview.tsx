"use client";

import { useEffect, useState } from "react";

// Versiya 2.62: clicking a parent menu item (Tapşırıqlar, Sənədlər, HR) opens its sub-menu and shows this overview instead of
// jumping into the first sub-section — one card per sub-section the user can open, with what is waiting there.

export type OverviewStat = { label: string; value: number | null; alert?: boolean };
export type OverviewCard = { key: string; title: string; text: string; stats?: OverviewStat[]; onOpen: () => void };

export function SectionOverview({ cards, loading }: { cards: OverviewCard[]; loading?: boolean }) {
  if (!cards.length) return null;
  return <div className="overviewgrid">{cards.map((card) => <button key={card.key} className="overviewcard" onClick={card.onOpen}>
    <b>{card.title}</b>
    <small>{card.text}</small>
    {card.stats && card.stats.length > 0 && <div className="overviewstats">{card.stats.map((s) => <span key={s.label} className={s.alert && s.value ? "alert" : ""}>
      <strong>{loading || s.value === null ? "…" : s.value}</strong>{s.label}
    </span>)}</div>}
    <i>Aç →</i>
  </button>)}</div>;
}

type Approval = { canFinal: boolean; departments: Array<{ canApprove: boolean }> } | undefined;
const approvalActionable = (a: Approval) => Boolean(a && (a.canFinal || a.departments.some((d) => d.canApprove)));
const waitsForDirector = (status: string) => status === "Rəhbərin baxışında" || status === "Rəhbərdə";

export function DocumentsOverview({ showTemplates, showOutgoing, showIncoming, activeCompanyId, open }: {
  showTemplates: boolean; showOutgoing: boolean; showIncoming: boolean; activeCompanyId: number | null;
  open: (tab: "templates" | "outgoing" | "incoming") => void;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const get = (url: string, on: boolean): Promise<Record<string, unknown>> => on ? fetch(url).then((r) => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({});
    void Promise.all([get("/api/documents", showTemplates), get("/api/documents/outgoing", showOutgoing), get("/api/documents/incoming", showIncoming)]).then(([tpl, out, inc]) => {
      if (cancelled) return;
      const inScope = (companyId: number | null) => !activeCompanyId || companyId === activeCompanyId;
      const outgoing = ((out.items || []) as Array<{ company_id: number | null; final_key: string | null; approval?: Approval }>).filter((i) => inScope(i.company_id));
      const incoming = ((inc.items || []) as Array<{ company_id: number; status: string; approval?: Approval }>).filter((i) => inScope(i.company_id));
      const directorOf = (inc.directorOf || []) as number[];
      setCounts({
        templates: ((tpl.items || []) as unknown[]).length,
        outgoing: outgoing.length, outgoingNoFinal: outgoing.filter((i) => !i.final_key).length, outgoingApproval: outgoing.filter((i) => approvalActionable(i.approval)).length,
        incoming: incoming.length, incomingDirector: incoming.filter((i) => waitsForDirector(i.status) && directorOf.includes(i.company_id)).length,
        incomingApproval: incoming.filter((i) => approvalActionable(i.approval)).length, isDirector: directorOf.length,
      });
    });
    return () => { cancelled = true; };
  }, [showTemplates, showOutgoing, showIncoming, activeCompanyId]);
  const n = (key: string) => counts ? counts[key] ?? 0 : null;
  const cards: OverviewCard[] = [];
  if (showIncoming) cards.push({ key: "incoming", title: "Daxil olan sənədlər", text: "Daxil olan sənədlərin qeydiyyatı, rəhbərin baxışı, tapşırıqlar və təsdiq.", onOpen: () => open("incoming"), stats: [
    { label: "sənəd", value: n("incoming") },
    ...(counts?.isDirector ? [{ label: "rəhbərin baxışında", value: n("incomingDirector"), alert: true }] : []),
    { label: "təsdiqimi gözləyir", value: n("incomingApproval"), alert: true },
  ] });
  if (showOutgoing) cards.push({ key: "outgoing", title: "Çıxan sənədlər", text: "Göndərilən sənədlərin qeydiyyatı, hazır sənəd və təsdiq.", onOpen: () => open("outgoing"), stats: [
    { label: "sənəd", value: n("outgoing") },
    { label: "hazır sənəd yüklənməyib", value: n("outgoingNoFinal"), alert: true },
    { label: "təsdiqimi gözləyir", value: n("outgoingApproval"), alert: true },
  ] });
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
