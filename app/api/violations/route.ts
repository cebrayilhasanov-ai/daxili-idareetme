import {
  createViolation, deleteViolation, employeeInCompanies, listViolations, listViolationsForCompanies, listViolationsForEmployee, updateViolation,
  violationInScope, violationScope, violationTargets,
} from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireAction, requireSection, sectionRights } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// Noqsanlar (Versiya 2.62): with only Baxış an employee sees the violations recorded on them; with Əlavə et, Dəyişiklik et or
// Sil they manage the violations of their firms' employees. The admin manages all of them.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

async function listBody(user: User) {
  const rights = await sectionRights(user, "hr.violations");
  const can = { add: rights.add, edit: rights.edit, delete: rights.delete };
  if (user.role === "admin") return { items: await listViolations(), can, manager: true };
  const manager = rights.add || rights.edit || rights.delete;
  if (!manager) return { items: user.employeeId ? await listViolationsForEmployee(user.employeeId) : [], can, manager: false };
  const scope = (await violationScope(user)) ?? [];
  return { items: await listViolationsForCompanies(scope, user.employeeId ?? null), can, manager: true, ...(await violationTargets(scope)) };
}

// The firm on a violation must be one of the employee's own firms (the admin may pick any).
async function checkTarget(user: User, employeeId: number | null, companyId: number | null) {
  const scope = await violationScope(user);
  if (!scope) return;
  if (companyId && !scope.includes(companyId)) throw new Error("FORBIDDEN");
  if (employeeId && !(await employeeInCompanies(employeeId, scope))) throw new Error("FORBIDDEN");
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "hr.violations");
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: "Qeydlər yüklənmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "hr.violations", "add");
    const body = await request.json();
    const companyId = body.companyId ? Number(body.companyId) : null;
    await checkTarget(user, Number(body.employeeId), companyId);
    await createViolation({ employeeId: Number(body.employeeId), companyId: companyId ?? undefined, title: String(body.title || ""), note: body.note, createdByName: user.name });
    await logAudit(user, "Noqsan qeydə alındı", "employee", `#${body.employeeId}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd saxlanmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "hr.violations", "edit");
    const body = await request.json();
    const id = Number(body.id);
    const companyId = body.companyId ? Number(body.companyId) : null;
    await violationInScope(id, await violationScope(user));
    await checkTarget(user, null, companyId);
    await updateViolation({ id, companyId, title: String(body.title || ""), note: body.note });
    await logAudit(user, "Noqsan qeydi dəyişdirildi", "employee", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd dəyişdirilmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "hr.violations", "delete");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "Silinəcək qeyd seçilməyib." }, { status: 400 });
    await violationInScope(id, await violationScope(user));
    await deleteViolation(id);
    await logAudit(user, "Noqsan qeydi silindi", "employee", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd silinmədi." }, { status: 500 }); }
}
