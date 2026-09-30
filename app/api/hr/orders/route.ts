import { cancelOrder, createLeaveOrder, getOrdersData, orderLabel, saveOrderSettings, signOrder, updateLeaveOrder } from "@/db/hr-orders";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// HR orders (Əmrlər): the admin and employees given the separate "Əmrlər" permission (closed by default).

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

async function ordersUser(request: Request) {
  return requireSection(await requireUser(request), "hr.orders");
}

export async function GET(request: Request) {
  try {
    await ordersUser(request);
    return Response.json(await getOrdersData());
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əmrlər açılmadı." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await ordersUser(request);
    const body = await request.json();
    let savedId: number | undefined;
    if (body.action === "leave") {
      if (body.id) { await updateLeaveOrder(body); await logAudit(user, "HR: məzuniyyət əmri dəyişdirildi", "hr_order", await orderLabel(Number(body.id))); savedId = Number(body.id); }
      else { savedId = await createLeaveOrder(user, body); await logAudit(user, "HR: məzuniyyət əmri qeydə alındı", "hr_order", await orderLabel(savedId)); }
    } else if (body.action === "sign") {
      await signOrder(body);
      await logAudit(user, "HR: əmrin imzalı nüsxəsi yükləndi", "hr_order", await orderLabel(Number(body.id)));
    } else if (body.action === "cancel") {
      await cancelOrder(body);
      await logAudit(user, "HR: əmr ləğv edildi", "hr_order", `${await orderLabel(Number(body.id))} — ${String(body.reason || "")}`);
    } else if (body.action === "settings") {
      await saveOrderSettings(body);
      await logAudit(user, "HR: əmr parametrləri dəyişdirildi", "hr_settings", null);
    } else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json({ ...(await getOrdersData()), savedId });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əmr saxlanmadı." }, { status: 400 }); }
}
