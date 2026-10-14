import { addPersonalWorkOwnNote, deletePersonalWorkOwnNote, getPersonalWorkOwnNotes, personalWorkOwnerId, updatePersonalWorkOwnNote } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";

// Versiya 3.26: "Qeydlərim" — the work's owner only. A head, or the admin (also in "İstifadəçi görünüşü"), gets 403.
async function requireOwner(user: Awaited<ReturnType<typeof requireUser>>, personalWorkId: number) {
  if (!personalWorkId) throw new Error("İş seçilməyib.");
  if ((await personalWorkOwnerId(personalWorkId)) !== user.id) throw new Error("FORBIDDEN");
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const personalWorkId = Number(new URL(request.url).searchParams.get("personalWorkId"));
    await requireOwner(user, personalWorkId);
    return Response.json({ notes: await getPersonalWorkOwnNotes(personalWorkId, user.id) });
  } catch (error) { return failure(error, "Qeydlər yüklənmədi."); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    const personalWorkId = Number(body.personalWorkId);
    await requireOwner(user, personalWorkId);
    return Response.json({ notes: await addPersonalWorkOwnNote({ personalWorkId, userId: user.id, text: String(body.text || "") }) });
  } catch (error) { return failure(error, "Qeyd əlavə olunmadı."); }
}

// A note is looked up by its id and its writer, so only one's own notes can be changed or deleted.
export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    return Response.json({ notes: await updatePersonalWorkOwnNote({ id: Number(body.id), userId: user.id, text: String(body.text || "") }) });
  } catch (error) { return failure(error, "Qeyd yenilənmədi."); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const id = Number(new URL(request.url).searchParams.get("id"));
    return Response.json({ notes: await deletePersonalWorkOwnNote({ id, userId: user.id }) });
  } catch (error) { return failure(error, "Qeyd silinmədi."); }
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return Response.json({ error: message || fallback }, { status: 500 });
}
