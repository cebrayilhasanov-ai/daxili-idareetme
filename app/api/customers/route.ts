import { createCustomer, deleteCustomer, getCustomers, updateCustomer } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    await requireSection(await requireUser(request), "dashboard.customers");
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    // Any signed-in user may add a customer; editing and deleting remain admin-only.
    const user = await requireSection(await requireUser(request), "dashboard.customers");
    const body = await request.json();
    await createCustomer(body);
    await logAudit(user, "Müştəri yaradıldı", "customer", body.name);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await updateCustomer({ ...body, id: Number(body.id) });
    await logAudit(user, "Müştəri yeniləndi", "customer", body.name || `#${body.id}`);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteCustomer(id);
    await logAudit(user, "Müştəri silindi", "customer", `#${id}`);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri silinmədi." }, { status: 500 }); }
}
