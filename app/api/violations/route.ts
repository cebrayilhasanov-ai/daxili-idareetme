import { createViolation, deleteViolation, listViolations, listViolationsForEmployee, updateViolation, violationTargets } from "@/db/catalog";
import { departmentScope, scopeCompanyIds, userScopeTest, type DepartmentScope } from "@/db/department-scope";
import { requireUser } from "@/lib/auth";
import { requireAction, requireSection, sectionRights } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// Noqsanlar (Versiya 2.62): with only Baxış an employee sees the violations recorded on them; with Əlavə et, Dəyişiklik et or
// Sil they manage violations — since 2.65 only of the people in the departments they oversee (db/department-scope.ts).
// The admin manages all of them.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;
type ViolationRow = { id: number; employee_id: number; company_id: number | null };

async function listBody(user: User) {
  const rights = await sectionRights(user, "hr.violations");
  const can = { add: rights.add, edit: rights.edit, delete: rights.delete };
  if (user.role === "admin") return { items: await listViolations(), can, manager: true };
  const manager = rights.add || rights.edit || rights.delete;
  if (!manager) return { items: user.employeeId ? await listViolationsForEmployee(user.employeeId) : [], can, manager: false };
  const scope = await departmentScope(user);
  const covers = await userScopeTest(scope);
  const items = ((await listViolations()) as ViolationRow[]).filter((v) => v.employee_id === user.employeeId || covers(v.employee_id, v.company_id));
  const targets = await violationTargets(scopeCompanyIds(scope) ?? []);
  const employees = (targets.employees as Array<{ id: number; name: string }>).filter((e) => covers(e.id, null));
  return { items, can, manager: true, employees, companies: targets.companies };
}

// A violation is recorded and changed only for people the user oversees, on one of the user's firms (the admin: anyone).
async function checkTarget(scope: DepartmentScope, employeeId: number, companyId: number | null) {
  if (scope === null) return;
  if (companyId && !scope.has(companyId)) throw new Error("FORBIDDEN");
  if (!(await userScopeTest(scope))(employeeId, companyId)) throw new Error("FORBIDDEN");
}
async function checkExisting(scope: DepartmentScope, id: number) {
  const row = ((await listViolations()) as ViolationRow[]).find((v) => v.id === id);
  if (!row) throw new Error("Qeyd tapılmadı.");
  await checkTarget(scope, row.employee_id, row.company_id);
  return row;
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
    await checkTarget(await departmentScope(user), Number(body.employeeId), companyId);
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
    const scope = await departmentScope(user);
    const row = await checkExisting(scope, id);
    await checkTarget(scope, row.employee_id, companyId);
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
    await checkExisting(await departmentScope(user), id);
    await deleteViolation(id);
    await logAudit(user, "Noqsan qeydi silindi", "employee", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd silinmədi." }, { status: 500 }); }
}
