import { createPersonalWork, deletePersonalWork, getPersonalWorks, updatePersonalWork, updatePersonalWorkStatus } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/runtime";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// Everyone — admin included — only sees their own created works. The one exception is an
// admin actively using "Personal görünüşü" (view as): they then see that specific employee's
// own list, via the linked login account, never anyone else's.
async function scopeUserId(user: Awaited<ReturnType<typeof requireUser>>, request: Request) {
  if (user.role !== "admin") return user.id;
  const employeeId = Number(new URL(request.url).searchParams.get("employeeId"));
  if (!employeeId) return user.id;
  const account = await env.DB.prepare("SELECT id FROM app_users WHERE employee_id = ?").bind(employeeId).first<{ id: number }>();
  return account?.id ?? -1;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const items = await getPersonalWorks(await scopeUserId(user, request));
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
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
    const items = await getPersonalWorks(await scopeUserId(user, request));
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    if (body.status) {
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
    const items = await getPersonalWorks(await scopeUserId(user, request));
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    await deletePersonalWork({ id: Number(params.get("id")), userId: user.id });
    const items = await getPersonalWorks(await scopeUserId(user, request));
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş silinmədi." }, { status: 500 }); }
}
