import { completeWorkAssignment, createCompany, createDateChangeRequest, createEmployee, createRecurring, createTask, createWorkAssignment, createWorkItem, deleteEmployee, deleteTask, getAllData, resolveDateChangeRequest, toggleWorkAssignment, toggleWorkDefinitionCompany, updateCompany, updateEmployee, updateRecurring, updateTask, updateWorkItem } from "@/db/catalog";
import { requireUser, setUserAvatar } from "@/lib/auth";
import { env } from "@/lib/runtime";
import { logAudit } from "@/lib/audit";

async function scopedData(user: Awaited<ReturnType<typeof requireUser>>) {
  const data = await getAllData();
  if (user.role === "admin") return data;
  // Non-admins also see their own direct reports (not the full registry) so they can pick a subordinate when delegating a task step.
  return { employees: data.employees.filter((item: any) => item.id === user.employeeId || item.manager_employee_id === user.employeeId), companies: data.companies, recurring: [], workItems: [], workAssignments: data.workAssignments.filter((item: any) => item.employee_id === user.employeeId), tasks: data.tasks.filter((item: any) => item.employee_id === user.employeeId), dateRequests: data.dateRequests.filter((item: any) => item.employee_id === user.employeeId) };
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try { const user = await requireUser(request); return Response.json(await scopedData(user)); }
  catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumatlar açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    if (body.action === "date-request") {
      if (!user.employeeId) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
      await createDateChangeRequest({ taskId: Number(body.taskId), employeeId: user.employeeId, proposedDueAt: body.proposedDueAt, reason: body.reason });
      return Response.json(await scopedData(user));
    }
    if (user.role !== "admin") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    if (body.action === "employee") { await createEmployee(body); await logAudit(user, "Personal yaradıldı", "employee", body.name); }
    else if (body.action === "company") { await createCompany(body); await logAudit(user, "Firma yaradıldı", "company", body.name); }
    else if (body.action === "task") await createTask(body);
    else if (body.action === "recurring") await createRecurring(body);
    else if (body.action === "work-item") await createWorkItem(body);
    else if (body.action === "work-assignment") await createWorkAssignment(body);
    else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await getAllData());
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat saxlanmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    if (body.action === "self-avatar") {
      if (user.employeeId) await updateEmployee({ id: user.employeeId, avatarKey: body.avatarKey || null });
      else await setUserAvatar(user.id, body.avatarKey || null);
      await logAudit(user, "Profil şəkli yeniləndi", "employee", `#${user.employeeId || user.id}`);
      return Response.json(await scopedData(user));
    }
    if (user.role !== "admin") {
      if (body.action === "work-completion") {
        await completeWorkAssignment({assignmentId:Number(body.assignmentId)}, user.employeeId);
        return Response.json(await scopedData(user));
      }
      if (body.action !== "task" || !body.userMode) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
      const task = await env.DB.prepare("SELECT employee_id FROM tasks WHERE id = ?").bind(Number(body.id)).first<{ employee_id: number }>();
      if (!task || task.employee_id !== user.employeeId) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    }
    if (body.action === "work-completion") await completeWorkAssignment({assignmentId:Number(body.assignmentId)}, null);
    else if (body.action === "employee") {
      await updateEmployee(body);
      if (user.role === "admin") {
        const isToggleOnly = body.name === undefined && body.position === undefined && body.email === undefined && body.companyIds === undefined;
        await logAudit(user, isToggleOnly ? (body.active ? "Personal aktiv edildi" : "Personal deaktiv edildi") : "Personal yeniləndi", "employee", `#${body.id}`);
      }
    }
    else if (body.action === "company") {
      await updateCompany(body);
      if (user.role === "admin") {
        const isToggleOnly = body.name === undefined && body.voen === undefined && body.manager === undefined;
        await logAudit(user, isToggleOnly ? (body.active ? "Firma aktiv edildi" : "Firma deaktiv edildi") : "Firma yeniləndi", "company", body.name || `#${body.id}`);
      }
    }
    else if (body.action === "task") await updateTask({ ...body, actorName: user.name });
    else if (body.action === "recurring") await updateRecurring(body);
    else if (body.action === "work-item") await updateWorkItem(body);
    else if (body.action === "work-assignment") await toggleWorkAssignment(body);
    else if (body.action === "work-definition-company") await toggleWorkDefinitionCompany(body);
    else if (body.action === "resolve-date-request") await resolveDateChangeRequest({ id: Number(body.id), approve: Boolean(body.approve), adminNote: body.adminNote, finalDueAt: body.finalDueAt });
    else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await scopedData(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const params = new URL(request.url).searchParams;
    const taskId = Number(params.get("taskId"));
    const employeeId = Number(params.get("employeeId"));
    if (taskId) await deleteTask(taskId, user.name);
    else if (employeeId) { await deleteEmployee(employeeId); await logAudit(user, "Personal silindi", "employee", `#${employeeId}`); }
    else return Response.json({ error: "Silinəcək məlumat seçilməyib." }, { status: 400 });
    return Response.json(await getAllData());
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat silinmədi." }, { status: 500 }); }
}
