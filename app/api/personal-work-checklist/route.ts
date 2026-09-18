import { createPersonalWorkChecklistItem, deletePersonalWorkChecklistItem, getPersonalWorkChecklist, togglePersonalWorkChecklistItem } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/runtime";

async function assertAccess(user: Awaited<ReturnType<typeof requireUser>>, personalWorkId: number) {
  if (!personalWorkId) throw new Error("İş seçilməyib.");
  if (user.role === "admin") return;
  const work = await env.DB.prepare("SELECT user_id FROM personal_works WHERE id = ?").bind(personalWorkId).first<{ user_id: number }>();
  if (!work || work.user_id !== user.id) throw new Error("FORBIDDEN");
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
    const personalWorkId = Number(new URL(request.url).searchParams.get("personalWorkId"));
    await assertAccess(user, personalWorkId);
    return Response.json({ items: await getPersonalWorkChecklist(personalWorkId) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const personalWorkId = Number(body.personalWorkId);
    await assertAccess(user, personalWorkId);
    const items = await createPersonalWorkChecklistItem({ personalWorkId, title: String(body.title || "") });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const id = Number(body.id);
    const existing = await env.DB.prepare("SELECT personal_work_id FROM personal_work_checklist_items WHERE id = ?").bind(id).first<{ personal_work_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertAccess(user, existing.personal_work_id);
    const items = await togglePersonalWorkChecklistItem({ id, done: Boolean(body.done) });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const existing = await env.DB.prepare("SELECT personal_work_id FROM personal_work_checklist_items WHERE id = ?").bind(id).first<{ personal_work_id: number }>();
    if (!existing) return Response.json({ error: "Addım tapılmadı." }, { status: 404 });
    await assertAccess(user, existing.personal_work_id);
    const items = await deletePersonalWorkChecklistItem({ id });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Addım silinmədi." }, { status: 500 }); }
}
