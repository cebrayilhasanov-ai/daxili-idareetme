import { cancelOrder, createLeaveOrder, createOtherOrder, createTerminationOrder, updateOtherOrder, getEmployeeSalaries, getOrdersData, orderGroup, orderLabel, saveOrderSettings, signOrder, updateLeaveOrder, updateTerminationOrder } from "@/db/hr-orders";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireSection, type SectionAction } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { departmentScope, narrowScope, widenScope, requireHrEmployeeInScope, requireOrderInScope, scopeHrData } from "@/db/department-scope";

// HR orders (Əmrlər): the admin and employees given the separate "Əmrlər" permission (closed by default).
// Rights (Versiya 2.62): Əlavə et — a new order; Dəyişiklik et — correcting an order, its signed copy; Sil — cancelling an order
// (orders are never deleted, a cancelled one stays in the register). Since Versiya 3.20 these rights are given per tab —
// Məzuniyyət, İşdən çıxma, Digər əmrlər — and Parametrlər (the numbering and the legal texts) has Baxış and Dəyişiklik et.
// The final settlement of a termination order (salaries, average pay) is shown only to those who may see the worker's
// Əmək haqqı in Personallar.
// Since Versiya 2.65 only the orders and workers of the departments the user oversees (db/department-scope.ts); since
// Versiya 3.61 in a firm where an order of any tab may be added — every department of it.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;
const GROUPS = ["leave", "termination", "other"];

// Versiya 2.99: the rights are per firm; Versiya 3.20: a tab's right reaches the workers of the firms where it is given.
async function ordersContext(user: User) {
  const [own, access, personnel] = await Promise.all([departmentScope(user), firmAccess(user, "hr.orders"), firmAccess(user, "hr.personnel")]);
  const scope = widenScope(own, access.admin ? null : [...new Set(GROUPS.flatMap((g) => access.partFirms(g, "add") ?? []))]);
  return {
    access,
    sectionScope: (action: SectionAction) => narrowScope(scope, access.firms(action)),
    partScope: (part: string, action: SectionAction) => narrowScope(scope, access.partFirms(part, action)),
    // Salaries and the settlement: Personallar → Əmək haqqı.
    payScope: narrowScope(widenScope(own, personnel.firms("add")), personnel.partFirms("salary", "view")),
    seesPay: (companyId: number) => personnel.admin || (personnel.firm(companyId).view && personnel.firm(companyId).parts.salary.view),
  };
}

async function ordersUser(request: Request) {
  return requireSection(await requireUser(request), "hr.orders");
}

type Row = Record<string, unknown>;
// The settlement kept with a signed termination order is left out where the user may not see the worker's salaries.
const withoutSettlement = (order: Row) => {
  try { const extra = JSON.parse(String(order.extra || "{}")); delete extra.settlement; return { ...order, extra: JSON.stringify(extra) }; } catch { return order; }
};

// Every answer carries the viewer's rights, so the page offers only what is allowed: per firm, the rights in each tab and
// whether the settlement may be seen (null for the admin — everything).
async function ordersBody(user: User, extra: Record<string, unknown> = {}) {
  const [data, ctx] = await Promise.all([getOrdersData(), ordersContext(user)]);
  const scoped = scopeHrData(data, ctx.sectionScope("view"));
  if (ctx.access.admin) return { ...scoped, partRights: null, paySeen: null, ...extra };
  const companies = scoped.companies as Array<{ id: number }>;
  const orders = (scoped.orders as Row[])
    .filter((o) => ctx.access.firm(Number(o.company_id)).parts[String(o.grp)]?.view)
    .map((o) => (o.grp === "termination" && !ctx.seesPay(Number(o.company_id)) ? withoutSettlement(o) : o));
  return {
    ...scoped, orders,
    partRights: Object.fromEntries(companies.map((c) => [String(c.id), ctx.access.firm(c.id).parts])),
    paySeen: Object.fromEntries(companies.map((c) => [String(c.id), ctx.seesPay(c.id)])),
    ...extra,
  };
}

export async function GET(request: Request) {
  try {
    const user = await ordersUser(request);
    // The final settlement of a worker being dismissed needs that worker's salaries (and only theirs) — for those who may see them.
    const salariesOf = Number(new URL(request.url).searchParams.get("salaries"));
    if (salariesOf) {
      const ctx = await ordersContext(user);
      await requireHrEmployeeInScope(ctx.sectionScope("view"), salariesOf);
      await requireHrEmployeeInScope(ctx.payScope, salariesOf);
      return Response.json(await getEmployeeSalaries(salariesOf));
    }
    return Response.json(await ordersBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əmrlər açılmadı." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await ordersUser(request);
    const body = await request.json();
    const ctx = await ordersContext(user);
    const creating = GROUPS.includes(String(body.action)) && !body.id;
    const action: SectionAction = creating ? "add" : body.action === "cancel" ? "delete" : "edit";
    if (body.action === "settings") {
      const firms = ctx.access.partFirms("settings", "edit");
      if (firms && !firms.length) throw new Error("FORBIDDEN");
      // The numbering is changed only for the firms where Parametrlər may be changed.
      if (firms && Array.isArray(body.numbering)) body.numbering = (body.numbering as Row[]).filter((n) => firms.includes(Number(n.companyId)));
    } else {
      // The tab of the order itself (a saved order is changed only as an order of its own tab).
      const part = body.id ? await orderGroup(Number(body.id)) : String(body.action);
      if (!GROUPS.includes(part) || (GROUPS.includes(String(body.action)) && part !== body.action)) return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
      const scope = ctx.partScope(part, action);
      if (body.id) await requireOrderInScope(scope, Number(body.id));
      if (body.hrEmployeeId) await requireHrEmployeeInScope(scope, Number(body.hrEmployeeId));
      else if (creating) throw new Error("İşçini seçin.");
    }
    let savedId: number | undefined;
    if (body.action === "leave") {
      if (body.id) { await updateLeaveOrder(body); await logAudit(user, "Kadrlar: məzuniyyət əmri dəyişdirildi", "hr_order", await orderLabel(Number(body.id))); savedId = Number(body.id); }
      else { savedId = await createLeaveOrder(user, body); await logAudit(user, "Kadrlar: məzuniyyət əmri qeydə alındı", "hr_order", await orderLabel(savedId)); }
    } else if (body.action === "termination") {
      if (body.id) { await updateTerminationOrder(body); await logAudit(user, "Kadrlar: işdən çıxma əmri dəyişdirildi", "hr_order", await orderLabel(Number(body.id))); savedId = Number(body.id); }
      else { savedId = await createTerminationOrder(user, body); await logAudit(user, "Kadrlar: işdən çıxma əmri qeydə alındı", "hr_order", await orderLabel(savedId)); }
    } else if (body.action === "other") {
      if (body.id) { await updateOtherOrder(body); await logAudit(user, "Kadrlar: əmr dəyişdirildi", "hr_order", await orderLabel(Number(body.id))); savedId = Number(body.id); }
      else { savedId = await createOtherOrder(user, body); await logAudit(user, "Kadrlar: əmr qeydə alındı", "hr_order", await orderLabel(savedId)); }
    } else if (body.action === "sign") {
      await signOrder(body);
      await logAudit(user, "Kadrlar: əmrin imzalı nüsxəsi yükləndi", "hr_order", await orderLabel(Number(body.id)));
    } else if (body.action === "cancel") {
      await cancelOrder(body);
      await logAudit(user, "Kadrlar: əmr ləğv edildi", "hr_order", `${await orderLabel(Number(body.id))} — ${String(body.reason || "")}`);
    } else if (body.action === "settings") {
      await saveOrderSettings(body);
      await logAudit(user, "Kadrlar: əmr parametrləri dəyişdirildi", "hr_settings", null);
    } else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await ordersBody(user, { savedId }));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əmr saxlanmadı." }, { status: 400 }); }
}
