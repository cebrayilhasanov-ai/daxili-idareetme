import { approveViolation, createViolation, deleteViolation, listViolations, listViolationsForEmployee, updateViolation, violationTargets } from "@/db/catalog";
import { departmentScope, narrowScope, scopeCompanyIds, userScopeTest, type DepartmentScope } from "@/db/department-scope";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireAction, requireSection, sectionRights, type SectionAction } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseFiles, withFiles } from "@/db/attachments";

// Nöqsanlar (Versiya 2.62): with only Baxış an employee sees the violations recorded on them; with Əlavə et, Dəyişiklik et or
// Sil they manage violations — since 2.65 only of the people in the departments they oversee (db/department-scope.ts).
// The admin manages all of them.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

// Versiya 2.99: the rights are per firm — managing reaches the people of the firms where the right is given.
async function violationScope(user: User, actions: SectionAction[]) {
  const [scope, access] = await Promise.all([departmentScope(user), firmAccess(user, "hr.violations")]);
  const firms = access.firms("view") === null ? null : [...new Set(actions.flatMap((a) => access.firms(a) ?? []))];
  return narrowScope(scope, firms);
}
type ViolationRow = { id: number; employee_id: number; company_id: number | null; approved_at: string | null; created_by_user_id: number | null };

// Versiya 3.17: every record comes with its "Əlaqəli məlumat" files; whoever sees the record (the worker too) sees them.
// Versiya 3.18: a draft is seen, changed, approved and deleted only by its author and the admin; an approved record is
// changed and deleted only by the admin. Each row says what this user may do with it.
async function listBody(user: User) {
  const body = await listRecords(user);
  const items = (body.items as ViolationRow[]).map((v) => {
    const draft = !v.approved_at;
    const own = user.role === "admin" || (draft && v.created_by_user_id === user.id);
    return { ...v, can_edit: own, can_delete: own, can_approve: draft && own };
  });
  return { ...body, items: await withFiles(items, "violation") };
}
const visibleTo = (user: User, v: ViolationRow) => Boolean(v.approved_at) || v.created_by_user_id === user.id;
async function listRecords(user: User) {
  const rights = await sectionRights(user, "hr.violations");
  const can = { add: rights.add, edit: rights.edit, delete: rights.delete };
  if (user.role === "admin") return { items: await listViolations(), can, manager: true };
  const manager = rights.add || rights.edit || rights.delete;
  if (!manager) return { items: user.employeeId ? await listViolationsForEmployee(user.employeeId) : [], can, manager: false };
  const scope = await violationScope(user, ["add", "edit", "delete"]);
  const covers = await userScopeTest(scope);
  const items = ((await listViolations()) as ViolationRow[]).filter((v) => visibleTo(user, v) && (v.employee_id === user.employeeId || covers(v.employee_id, v.company_id)));
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
    await checkTarget(await violationScope(user, ["add"]), Number(body.employeeId), companyId);
    await createViolation({ employeeId: Number(body.employeeId), companyId: companyId ?? undefined, title: String(body.title || ""), note: body.note, createdByName: user.name, createdByUserId: user.id, files: parseFiles(body.files) });
    await logAudit(user, "Nöqsan qaralaması yazıldı", "employee", `#${body.employeeId}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd saxlanmadı." }, { status: 400 }); }
}

// Versiya 3.18: who may touch a record — a draft its author (who wrote it with Əlavə et) or the admin, an approved one the admin.
async function ownRecord(user: User, id: number) {
  const row = ((await listViolations()) as ViolationRow[]).find((v) => v.id === id);
  if (!row) throw new Error("Qeyd tapılmadı.");
  if (user.role === "admin") return row;
  if (row.approved_at) throw new Error("Təsdiqlənmiş qeydi yalnız admin dəyişə və silə bilər.");
  if (row.created_by_user_id !== user.id) throw new Error("Qaralamanı yalnız onu yazan şəxs dəyişə, təsdiqləyə və silə bilər.");
  await checkTarget(await violationScope(user, ["add", "edit"]), row.employee_id, row.company_id);
  return row;
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "hr.violations");
    const body = await request.json();
    const id = Number(body.id);
    const row = await ownRecord(user, id);
    if (body.action === "approve") {
      await approveViolation(id);
      await logAudit(user, "Nöqsan təsdiqləndi", "employee", `#${row.employee_id}`);
      return Response.json(await listBody(user));
    }
    const companyId = body.companyId ? Number(body.companyId) : null;
    const scope = user.role === "admin" ? null : await violationScope(user, ["add", "edit"]);
    await checkTarget(scope, row.employee_id, companyId);
    await updateViolation({ id, companyId, title: String(body.title || ""), note: body.note, files: Array.isArray(body.files) ? parseFiles(body.files) : undefined });
    await logAudit(user, "Nöqsan qeydi dəyişdirildi", "employee", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd dəyişdirilmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "hr.violations");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "Silinəcək qeyd seçilməyib." }, { status: 400 });
    await ownRecord(user, id);
    await deleteViolation(id);
    await logAudit(user, "Nöqsan qeydi silindi", "employee", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Qeyd silinmədi." }, { status: 500 }); }
}
