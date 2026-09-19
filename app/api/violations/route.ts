import { createViolation, deleteViolation, listViolations, listViolationsForEmployee } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role === "admin") return Response.json({ items: await listViolations() });
    if (!user.employeeId) return Response.json({ items: [] });
    return Response.json({ items: await listViolationsForEmployee(user.employeeId) });
  } catch (error) { return authError(error) || Response.json({ error: "Qeydlər yüklənmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await createViolation({ employeeId: Number(body.employeeId), companyId: body.companyId ? Number(body.companyId) : undefined, title: String(body.title || ""), note: body.note, createdByName: user.name });
    await logAudit(user, "Noqsan qeydə alındı", "employee", `#${body.employeeId}`);
    return Response.json({ items: await listViolations() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd saxlanmadı." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "Silinəcək qeyd seçilməyib." }, { status: 400 });
    await deleteViolation(id);
    await logAudit(user, "Noqsan qeydi silindi", "employee", `#${id}`);
    return Response.json({ items: await listViolations() });
  } catch (error) { return authError(error) || Response.json({ error: "Qeyd silinmədi." }, { status: 500 }); }
}
