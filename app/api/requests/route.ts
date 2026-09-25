import { countActionableRequests, createRequest, deleteRequest, getRequestEvents, listRequests, updateRequest } from "@/db/requests";
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
    const params = new URL(request.url).searchParams;
    if (params.get("summary")) return Response.json({ actionable: await countActionableRequests(user) });
    const eventsFor = Number(params.get("events"));
    if (eventsFor) return Response.json({ events: await getRequestEvents(user, eventsFor) });
    return Response.json(await listRequests(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğular açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
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
    return Response.json(await listRequests(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu göndərilmədi." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    await updateRequest(user, { id: Number(body.id), action: String(body.action || ""), assigneeId: body.assigneeId ? Number(body.assigneeId) : undefined, agreedDueAt: body.agreedDueAt, text: body.text, score: body.score });
    return Response.json({ ...(await listRequests(user)), events: await getRequestEvents(user, Number(body.id)) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    await deleteRequest(user, Number(new URL(request.url).searchParams.get("id")));
    return Response.json(await listRequests(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu silinmədi." }, { status: 400 }); }
}
