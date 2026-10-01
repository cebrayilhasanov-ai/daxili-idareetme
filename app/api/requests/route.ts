import { countActionableRequests, createRequest, deleteRequest, getRequestEvents, listRequests, updateRequest } from "@/db/requests";
import { requireUser } from "@/lib/auth";
import { requireAction, requireSection, sectionRights } from "@/lib/permissions";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

// Rights (Versiya 2.62): Əlavə et — a new request; Dəyişiklik et — every step on a request (accept, assign, answer, close,
// comment, evaluate); Sil — deleting one. The per-request buttons are masked by them, so the page only offers what is allowed.
async function listFor(user: User) {
  const [body, rights] = await Promise.all([listRequests(user), sectionRights(user, "tasks.requests")]);
  const items = body.items.map((item) => ({
    ...item,
    can: Object.fromEntries(Object.entries(item.can).map(([key, value]) => [key, Boolean(value) && (key === "remove" ? rights.delete : rights.edit)])),
    actionable: Boolean(item.actionable) && rights.edit,
  }));
  return { ...body, items, canAdd: rights.add };
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.requests");
    const params = new URL(request.url).searchParams;
    if (params.get("summary")) return Response.json({ actionable: (await sectionRights(user, "tasks.requests")).edit ? await countActionableRequests(user) : 0 });
    const eventsFor = Number(params.get("events"));
    if (eventsFor) return Response.json({ events: await getRequestEvents(user, eventsFor) });
    return Response.json(await listFor(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğular açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "tasks.requests", "add");
    const body = await request.json();
    await createRequest(user, {
      companyId: Number(body.companyId),
      toDepartment: String(body.toDepartment || ""),
      title: String(body.title || ""),
      description: body.description,
      desiredDueAt: body.desiredDueAt,
      attachmentKey: body.attachmentKey,
      attachmentName: body.attachmentName,
      attachmentSize: body.attachmentSize,
      attachmentType: body.attachmentType,
    });
    return Response.json(await listFor(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu göndərilmədi." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "tasks.requests", "edit");
    const body = await request.json();
    await updateRequest(user, { id: Number(body.id), action: String(body.action || ""), assigneeId: body.assigneeId ? Number(body.assigneeId) : undefined, agreedDueAt: body.agreedDueAt, text: body.text, score: body.score });
    return Response.json({ ...(await listFor(user)), events: await getRequestEvents(user, Number(body.id)) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "tasks.requests", "delete");
    await deleteRequest(user, Number(new URL(request.url).searchParams.get("id")));
    return Response.json(await listFor(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu silinmədi." }, { status: 400 }); }
}
