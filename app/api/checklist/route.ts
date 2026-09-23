import { createChecklistItem, delegateTaskChecklistItem, deleteChecklistItem, getChecklistItems, setChecklistItemAttachment, toggleChecklistItem } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/runtime";

async function assertTaskAccess(user: Awaited<ReturnType<typeof requireUser>>, taskId: number) {
  if (!taskId) throw new Error("Tapşırıq seçilməyib.");
  if (user.role === "admin") return;
  const task = await env.DB.prepare("SELECT employee_id FROM tasks WHERE id = ?").bind(taskId).first<{ employee_id: number }>();
  if (!task || task.employee_id !== user.employeeId) throw new Error("FORBIDDEN");
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const taskId = Number(new URL(request.url).searchParams.get("taskId"));
    await assertTaskAccess(user, taskId);
    return Response.json({ items: await getChecklistItems(taskId) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const taskId = Number(body.taskId);
    await assertTaskAccess(user, taskId);
    const items = await createChecklistItem({ taskId, title: String(body.title || "") });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const id = Number(body.id);
    const existing = await env.DB.prepare("SELECT task_id FROM task_checklist_items WHERE id = ?").bind(id).first<{ task_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertTaskAccess(user, existing.task_id);
    const items = body.action === "delegate"
      ? await delegateTaskChecklistItem({ id, isAdmin: user.role === "admin", actorEmployeeId: user.employeeId, actorName: user.name, employeeId: Number(body.employeeId), comment: body.comment })
      : body.removeAttachment || body.attachmentKey
      ? await setChecklistItemAttachment({
          id,
          attachment: body.removeAttachment ? null : { key: String(body.attachmentKey), name: String(body.attachmentName || "fayl"), size: Number(body.attachmentSize) || 0, type: String(body.attachmentType || "application/octet-stream") },
        })
      : await toggleChecklistItem({ id, done: Boolean(body.done) });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const existing = await env.DB.prepare("SELECT task_id FROM task_checklist_items WHERE id = ?").bind(id).first<{ task_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertTaskAccess(user, existing.task_id);
    const items = await deleteChecklistItem({ id });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım silinmədi." }, { status: 500 }); }
}
