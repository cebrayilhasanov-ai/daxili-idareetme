import { createPersonalWork, deletePersonalWork, getPersonalWorks, updatePersonalWorkStatus } from "@/db/catalog";
import { requireUser } from "@/lib/auth";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const items = await getPersonalWorks(user.role === "admin" ? null : user.id);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    await createPersonalWork({
      userId: user.id,
      title: String(body.title || ""),
      description: body.description,
      companyId: body.companyId ? Number(body.companyId) : undefined,
      dueAt: body.dueAt || undefined,
      attachmentKey: body.attachmentKey,
      attachmentName: body.attachmentName,
      attachmentSize: body.attachmentSize,
      attachmentType: body.attachmentType,
    });
    const items = await getPersonalWorks(user.role === "admin" ? null : user.id);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    await updatePersonalWorkStatus({ id: Number(body.id), userId: user.id, status: String(body.status || "") });
    const items = await getPersonalWorks(user.role === "admin" ? null : user.id);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    await deletePersonalWork({ id: Number(params.get("id")), userId: user.id });
    const items = await getPersonalWorks(user.role === "admin" ? null : user.id);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "İş silinmədi." }, { status: 500 }); }
}
