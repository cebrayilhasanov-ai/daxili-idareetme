import { createPersonalWork, deletePersonalWork, getPersonalWorks, getTeamPersonalWorks, updatePersonalWork, updatePersonalWorkFile, updatePersonalWorkStatus } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireSection } from "@/lib/permissions";
import { env } from "@/lib/runtime";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// "Mənim işlərim": everyone — admin included — only sees their own created works. The one exception is an
// admin actively using "Personal görünüşü" (view as): they then see that specific employee's
// own list, via the linked login account, never anyone else's.
async function scopeUserId(user: Awaited<ReturnType<typeof requireUser>>, request: Request) {
  if (user.role !== "admin") return user.id;
  const employeeId = Number(new URL(request.url).searchParams.get("employeeId"));
  if (!employeeId) return user.id;
  const account = await env.DB.prepare("SELECT id FROM app_users WHERE employee_id = ?").bind(employeeId).first<{ id: number }>();
  return account?.id ?? -1;
}

// "Əməkdaşlarımın işləri" (Versiya 2.85): the works of the viewer's staff; for an admin in "view as", that employee's staff.
async function teamViewer(user: Awaited<ReturnType<typeof requireUser>>, request: Request) {
  const employeeId = Number(new URL(request.url).searchParams.get("employeeId"));
  if (user.role !== "admin" || !employeeId) return { userId: user.id, employeeId: user.employeeId, isAdmin: user.role === "admin" };
  const account = await env.DB.prepare("SELECT id FROM app_users WHERE employee_id = ?").bind(employeeId).first<{ id: number }>();
  return { userId: account?.id ?? -1, employeeId, isAdmin: false };
}

// Versiya 2.100: Şəxsi işlərim is given per firm — only the works of the firms where it is open (a work without a firm stays).
async function ownWorks(user: Awaited<ReturnType<typeof requireUser>>, request: Request) {
  const items = await getPersonalWorks(await scopeUserId(user, request));
  const firms = (await firmAccess(user, "tasks.mine")).firms("view");
  return firms ? items.filter((work) => { const companyId = (work as { company_id?: unknown }).company_id; return !companyId || firms.includes(Number(companyId)); }) : items;
}
async function requireWorkFirm(user: Awaited<ReturnType<typeof requireUser>>, companyId: unknown) {
  if (!Number(companyId)) return;
  const firms = (await firmAccess(user, "tasks.mine")).firms("view");
  if (firms && !firms.includes(Number(companyId))) throw new Error("FORBIDDEN");
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    if (new URL(request.url).searchParams.get("scope") === "team") return Response.json(await getTeamPersonalWorks(await teamViewer(user, request)));
    const items = await ownWorks(user, request);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    // Versiya 2.97: the admin account keeps no personal works.
    if (user.role === "admin") return Response.json({ error: "Admin hesabı iş və tapşırıq yaratmır — bunu öz istifadəçi hesabınızdan edin." }, { status: 403 });
    const body = await request.json();
    await requireWorkFirm(user, body.companyId);
    await createPersonalWork({
      userId: user.id,
      actorName: user.name,
      title: String(body.title || ""),
      description: body.description,
      companyId: body.companyId ? Number(body.companyId) : undefined,
      dueAt: body.dueAt || undefined,
      attachmentKey: body.attachmentKey,
      attachmentName: body.attachmentName,
      attachmentSize: body.attachmentSize,
      attachmentType: body.attachmentType,
    });
    const items = await ownWorks(user, request);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    if (!body.status) await requireWorkFirm(user, body.companyId);
    if (body.action === "file") {
      // Versiya 2.102: only the work's file — allowed in every status, a completed work too.
      await updatePersonalWorkFile({ id: Number(body.id), userId: user.id, actorName: user.name, attachment: body.removeAttachment ? null : { key: String(body.attachmentKey || ""), name: String(body.attachmentName || "fayl"), size: Number(body.attachmentSize) || 0, type: String(body.attachmentType || "application/octet-stream") } });
    } else if (body.status) {
      await updatePersonalWorkStatus({ id: Number(body.id), userId: user.id, actorName: user.name, status: String(body.status || "") });
    } else {
      await updatePersonalWork({
        id: Number(body.id),
        userId: user.id,
        actorName: user.name,
        title: String(body.title || ""),
        description: body.description,
        companyId: body.companyId ? Number(body.companyId) : null,
        dueAt: body.dueAt || null,
        removeAttachment: body.removeAttachment,
        attachmentKey: body.attachmentKey,
        attachmentName: body.attachmentName,
        attachmentSize: body.attachmentSize,
        attachmentType: body.attachmentType,
      });
    }
    const items = await ownWorks(user, request);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const params = new URL(request.url).searchParams;
    await deletePersonalWork({ id: Number(params.get("id")), userId: user.id });
    const items = await ownWorks(user, request);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş silinmədi." }, { status: 500 }); }
}
