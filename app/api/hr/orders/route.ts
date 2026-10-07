import { cancelOrder, createLeaveOrder, createOtherOrder, createTerminationOrder, updateOtherOrder, getEmployeeSalaries, getOrdersData, orderLabel, saveOrderSettings, signOrder, updateLeaveOrder, updateTerminationOrder } from "@/db/hr-orders";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireAction, requireSection, sectionRights, type SectionAction } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { departmentScope, narrowScope, requireHrEmployeeInScope, requireOrderInScope, scopeHrData } from "@/db/department-scope";

// HR orders (Əmrlər): the admin and employees given the separate "Əmrlər" permission (closed by default).
// Rights (Versiya 2.62): Əlavə et — a new order; Dəyişiklik et — correcting an order, its signed copy, the numbering settings;
// Sil — cancelling an order (orders are never deleted, a cancelled one stays in the register).
// Since Versiya 2.65 only the orders and workers of the departments the user oversees (db/department-scope.ts).

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// Versiya 2.99: the rights are per firm — each right reaches the workers of the firms where it is given.
async function ordersScope(user: Awaited<ReturnType<typeof requireUser>>, action: SectionAction) {
  const [scope, access] = await Promise.all([departmentScope(user), firmAccess(user, "hr.orders")]);
  return narrowScope(scope, access.firms(action));
}

async function ordersUser(request: Request) {
  return requireSection(await requireUser(request), "hr.orders");
}

// Every answer carries the viewer's rights, so the page offers only what is allowed.
async function ordersBody(user: Awaited<ReturnType<typeof requireUser>>, extra: Record<string, unknown> = {}) {
  const [data, rights, scope] = await Promise.all([getOrdersData(), sectionRights(user, "hr.orders"), ordersScope(user, "view")]);
  return { ...scopeHrData(data, scope), rights: { add: rights.add, edit: rights.edit, delete: rights.delete }, ...extra };
}

export async function GET(request: Request) {
  try {
    const user = await ordersUser(request);
    // The final settlement of a worker being dismissed needs that worker's salaries (and only theirs).
    const salariesOf = Number(new URL(request.url).searchParams.get("salaries"));
    if (salariesOf) {
      await requireHrEmployeeInScope(await ordersScope(user, "view"), salariesOf);
      return Response.json(await getEmployeeSalaries(salariesOf));
    }
    return Response.json(await ordersBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əmrlər açılmadı." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await ordersUser(request);
    const body = await request.json();
    const creating = ["leave", "termination", "other"].includes(String(body.action)) && !body.id;
    const action = creating ? "add" : body.action === "cancel" ? "delete" : "edit";
    await requireAction(user, "hr.orders", action);
    if (body.action !== "settings") {
      const scope = await ordersScope(user, action);
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
