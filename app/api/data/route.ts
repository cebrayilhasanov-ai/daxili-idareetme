import { canApproveTask, completeWorkAssignment, deleteWorkItem, setFixedWorksStart, uncompleteWorkAssignment, createCompany, createDateChangeRequest, createEmployee, createRecurring, createTask, createWorkAssignment, createWorkItem, deleteEmployee, deleteTask, getAllData, resolveDateChangeRequest, tasksGivenBy, toggleWorkAssignment, toggleWorkDefinitionCompany, updateCompany, updateEmployee, updateRecurring, updateTask, updateWorkItem } from "@/db/catalog";
import { requireUser, setUserAvatar } from "@/lib/auth";
import { env } from "@/lib/runtime";
import { hiddenSections, requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

async function scopedData(user: Awaited<ReturnType<typeof requireUser>>) {
  const data = await getAllData();
  if (user.role === "admin") return { ...data, approvals: [] };
  const hidden = await hiddenSections(user);
  const frequencyVisible = (frequency: unknown) => !(frequency === "monthly" && hidden.has("tasks.monthly")) && !(frequency === "weekly" && hidden.has("tasks.weekly"));
  // Non-admins also see their own direct reports (not the full registry) so they can pick a subordinate when delegating a task step.
  // Versiya 2.82: the tasks this user gave (handed-on steps, the director's dərkənar) that wait for their approval.
  const given = await tasksGivenBy(user);
  const approvals = data.tasks.filter((item: any) => given.has(Number(item.id)) && item.status === "Təqdim edilib");
  const ownCompanyIds = new Set(((data.employees.find((item: any) => item.id === user.employeeId) as { company_ids?: string } | undefined)?.company_ids || "").split(",").filter(Boolean).map(Number));
  return { fixedWorksStart: data.fixedWorksStart, employees: data.employees.filter((item: any) => item.id === user.employeeId || item.manager_employee_id === user.employeeId), companies: data.companies.filter((item: any) => ownCompanyIds.has(item.id)), recurring: [], workItems: [], workAssignments: data.workAssignments.filter((item: any) => item.employee_id === user.employeeId && frequencyVisible(item.frequency)), workCompletions: data.workCompletions.filter((item: any) => data.workAssignments.some((a: any) => a.id === item.work_assignment_id && a.employee_id === user.employeeId)), tasks: data.tasks.filter((item: any) => item.employee_id === user.employeeId), dateRequests: data.dateRequests.filter((item: any) => item.employee_id === user.employeeId), approvals };
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
      if (body.action === "work-completion" || body.action === "work-uncompletion") {
        const assignment = await env.DB.prepare("SELECT d.frequency FROM work_assignments a JOIN work_definitions d ON d.id = a.work_definition_id WHERE a.id = ?").bind(Number(body.assignmentId)).first<{ frequency: string }>();
        if (assignment?.frequency === "monthly") await requireSection(user, "tasks.monthly");
        if (assignment?.frequency === "weekly") await requireSection(user, "tasks.weekly");
        if (body.action === "work-uncompletion") {
          // Versiya 2.89: one's own mark, until the period's deadline.
          const title = await uncompleteWorkAssignment({assignmentId:Number(body.assignmentId), periodKey:body.periodKey}, user.employeeId);
          await logAudit(user, "Sabit işin icra qeydi geri götürüldü", "work-assignment", `${title} — ${body.periodKey}`);
        } else await completeWorkAssignment({assignmentId:Number(body.assignmentId), periodKey:body.periodKey}, user.employeeId);
        return Response.json(await scopedData(user));
      }
      // Whoever gave the task approves it or sends it back (Versiya 2.82); otherwise one moves only one's own task.
      const reviewing = body.action === "task" && !body.userMode && (body.status === "Təsdiqlənib" || body.status === "Geri qaytarılıb");
      if (reviewing) {
        if (!(await canApproveTask(user, Number(body.id)))) return Response.json({ error: "Bu tapşırığı yalnız onu verən şəxs təsdiqləyə bilər." }, { status: 403 });
        await updateTask({ id: Number(body.id), status: body.status, evaluation: body.evaluation, evaluationNote: body.evaluationNote, actorName: user.name });
        await logAudit(user, body.status === "Təsdiqlənib" ? "Tapşırıq təsdiqləndi" : "Tapşırıq geri qaytarıldı", "task", `#${body.id}`);
        return Response.json(await scopedData(user));
      }
      if (body.action !== "task" || !body.userMode) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
      const task = await env.DB.prepare("SELECT employee_id FROM tasks WHERE id = ?").bind(Number(body.id)).first<{ employee_id: number }>();
      if (!task || task.employee_id !== user.employeeId) return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    }
    if (body.action === "work-completion") await completeWorkAssignment({assignmentId:Number(body.assignmentId), periodKey:body.periodKey}, null);
    else if (body.action === "work-uncompletion") {
      const title = await uncompleteWorkAssignment({assignmentId:Number(body.assignmentId), periodKey:body.periodKey}, null);
      await logAudit(user, "Sabit işin icra qeydi geri götürüldü", "work-assignment", `${title} — ${body.periodKey}`);
    }
    else if (body.action === "fixed-works-start") {
      await setFixedWorksStart(String(body.value || ""));
      await logAudit(user, "Sabit işlərin hesablama başlanğıcı dəyişdirildi", "setting", String(body.value));
    }
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
    else if (body.action === "work-item") {
      const renamed = await updateWorkItem(body);
      if (renamed) await logAudit(user, "Sabit iş redaktə edildi", "work-definition", renamed.before === renamed.after ? renamed.after : `${renamed.before} → ${renamed.after}`);
    }
    else if (body.action === "work-assignment") {
      await toggleWorkAssignment(body);
      // Versiya 2.90: taking a work back from a person removes their marks too, so it is logged.
      if (!body.selected) await logAudit(user, "Sabit iş işçidən götürüldü", "work-assignment", `iş #${body.workDefinitionId}, işçi #${body.employeeId}, firma #${body.companyId}`);
    }
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
    else if (Number(params.get("workDefinitionId"))) { const title = await deleteWorkItem(Number(params.get("workDefinitionId"))); await logAudit(user, "Sabit iş silindi", "work-definition", title); }
    else return Response.json({ error: "Silinəcək məlumat seçilməyib." }, { status: 400 });
    return Response.json(await getAllData());
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat silinmədi." }, { status: 500 }); }
}
