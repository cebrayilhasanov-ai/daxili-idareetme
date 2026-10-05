import { addPersonalWorkNote, getPersonalWorkHistory, personalWorkAccess } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const personalWorkId = Number(new URL(request.url).searchParams.get("personalWorkId"));
    if (!personalWorkId) throw new Error("İş seçilməyib.");
    if (!(await personalWorkAccess(viewerOf(user), personalWorkId))) throw new Error("FORBIDDEN");
    return Response.json({ events: await getPersonalWorkHistory(personalWorkId) });
  } catch (error) { return failure(error, "Tarixçə yüklənmədi."); }
}

// Versiya 2.85: a head (or the admin) leaves a note on a staff member's work; it shows in the work's history for both.
export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const body = await request.json();
    const personalWorkId = Number(body.personalWorkId);
    if (!personalWorkId) throw new Error("İş seçilməyib.");
    if ((await personalWorkAccess(viewerOf(user), personalWorkId)) !== "supervisor") throw new Error("FORBIDDEN");
    await addPersonalWorkNote({ personalWorkId, actorName: user.name, text: String(body.text || "") });
    return Response.json({ events: await getPersonalWorkHistory(personalWorkId) });
  } catch (error) { return failure(error, "Qeyd əlavə olunmadı."); }
}

function viewerOf(user: Awaited<ReturnType<typeof requireUser>>) {
  return { userId: user.id, employeeId: user.employeeId, isAdmin: user.role === "admin" };
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return Response.json({ error: message || fallback }, { status: 500 });
}
