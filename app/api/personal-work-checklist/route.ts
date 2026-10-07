import { createPersonalWorkChecklistItem, delegatePersonalWorkChecklistItem, deletePersonalWorkChecklistItem, getPersonalWorkChecklist, getPersonalWorkDelegateCandidates, getPersonalWorkRequestTargets, personalWorkAccess, requestPersonalWorkChecklistItem, setPersonalWorkChecklistItemAttachment, togglePersonalWorkChecklistItem } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireAction, requireSection } from "@/lib/permissions";
import { env } from "@/lib/runtime";
import { parseFiles } from "@/db/attachments";

async function assertAccess(user: Awaited<ReturnType<typeof requireUser>>, personalWorkId: number) {
  if (!personalWorkId) throw new Error("İş seçilməyib.");
  if (user.role === "admin") return;
  const work = await env.DB.prepare("SELECT user_id FROM personal_works WHERE id = ?").bind(personalWorkId).first<{ user_id: number }>();
  if (!work || work.user_id !== user.id) throw new Error("FORBIDDEN");
}

async function mayRequestFrom(user: Awaited<ReturnType<typeof requireUser>>, personalWorkId: number) {
  const work = await env.DB.prepare("SELECT company_id FROM personal_works WHERE id = ?").bind(personalWorkId).first<{ company_id: number | null }>();
  return Boolean(work?.company_id && (await firmAccess(user, "tasks.requests")).firm(work.company_id).add);
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const personalWorkId = Number(new URL(request.url).searchParams.get("personalWorkId"));
    // Versiya 2.85: a head may look at a staff member's steps (read-only) — no hand-over candidates or request targets for them.
    if (!personalWorkId) throw new Error("İş seçilməyib.");
    const access = await personalWorkAccess({ userId: user.id, employeeId: user.employeeId, isAdmin: user.role === "admin" }, personalWorkId);
    if (!access) throw new Error("FORBIDDEN");
    // Versiya 2.97: the admin gives no tasks or requests from a work's steps, so gets no candidates or targets either.
    if (access === "supervisor" || user.role === "admin") return Response.json({ items: await getPersonalWorkChecklist(personalWorkId), candidates: [], canRequest: false, requestDepartments: [], ownDepartment: null });
    // A step can be sent to another department only by someone who may add Sorğular in the work's firm (Versiya 2.99: per firm).
    const canRequest = await mayRequestFrom(user, personalWorkId);
    const targets = canRequest ? await getPersonalWorkRequestTargets(personalWorkId, user.employeeId) : { departments: [], ownDepartment: null };
    return Response.json({ items: await getPersonalWorkChecklist(personalWorkId), candidates: await getPersonalWorkDelegateCandidates(personalWorkId), canRequest, requestDepartments: targets.departments, ownDepartment: targets.ownDepartment });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    const personalWorkId = Number(body.personalWorkId);
    await assertAccess(user, personalWorkId);
    const items = await createPersonalWorkChecklistItem({ personalWorkId, actorName: user.name, title: String(body.title || "") });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    const id = Number(body.id);
    const existing = await env.DB.prepare("SELECT personal_work_id FROM personal_work_checklist_items WHERE id = ?").bind(id).first<{ personal_work_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertAccess(user, existing.personal_work_id);
    if (user.role === "admin" && (body.requestDepartment || body.delegateEmployeeId)) return Response.json({ error: "Admin hesabı iş və tapşırıq yaratmır — bunu öz istifadəçi hesabınızdan edin." }, { status: 403 });
    if (body.requestDepartment) {
      await requireAction(user, "tasks.requests", "add");
      if (!(await mayRequestFrom(user, existing.personal_work_id))) throw new Error("FORBIDDEN");
      const items = await requestPersonalWorkChecklistItem(user, { id, toDepartment: String(body.requestDepartment), title: body.title, description: body.description, desiredDueAt: body.desiredDueAt, files: parseFiles(body.files, { key: body.attachmentKey, name: body.attachmentName, size: body.attachmentSize, type: body.attachmentType }) });
      return Response.json({ items });
    }
    const items = body.delegateEmployeeId
      ? await delegatePersonalWorkChecklistItem({ id, userId: user.id, actorName: user.name, employeeId: Number(body.delegateEmployeeId), comment: String(body.comment || "") })
      // Versiya 3.04: files are added to a step (addFiles) or one is removed (removeFileKey).
      : body.addFiles || body.removeFileKey
        ? await setPersonalWorkChecklistItemAttachment({ id, actorName: user.name, add: parseFiles(body.addFiles), removeKey: body.removeFileKey ? String(body.removeFileKey) : undefined })
        : await togglePersonalWorkChecklistItem({ id, actorName: user.name, done: Boolean(body.done) });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const id = Number(new URL(request.url).searchParams.get("id"));
    const existing = await env.DB.prepare("SELECT personal_work_id FROM personal_work_checklist_items WHERE id = ?").bind(id).first<{ personal_work_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertAccess(user, existing.personal_work_id);
    const items = await deletePersonalWorkChecklistItem({ id, actorName: user.name });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım silinmədi." }, { status: 500 }); }
}
