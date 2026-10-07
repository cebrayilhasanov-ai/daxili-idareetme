import { createRequest, deleteRequest, getRequestEvents, listRequests, updateRequest } from "@/db/requests";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireAction, requireSection } from "@/lib/permissions";
import { env } from "@/lib/runtime";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

// Rights (Versiya 2.62): Əlavə et — a new request; Dəyişiklik et — every step on a request (accept, assign, answer, close,
// comment, evaluate); Sil — deleting one. The per-request buttons are masked by them, so the page only offers what is allowed.
// Since Versiya 2.99 the rights are per firm: a request is seen and handled by the rights of its own firm, and a new one is sent
// only within a firm where Əlavə et is given.
async function listFor(user: User) {
  const [body, access] = await Promise.all([listRequests(user), firmAccess(user, "tasks.requests")]);
  const items = body.items.flatMap((item) => {
    const rights = access.firm(Number(item.company_id));
    if (!rights.view) return [];
    return [{
      ...item,
      can: Object.fromEntries(Object.entries(item.can).map(([key, value]) => [key, Boolean(value) && (key === "remove" ? rights.delete : rights.edit)])),
      actionable: Boolean(item.actionable) && rights.edit,
    }];
  });
  const addFirms = access.firms("add");
  const departments = addFirms ? Object.fromEntries(Object.entries(body.departments).filter(([companyId]) => addFirms.includes(Number(companyId)))) : body.departments;
  return { ...body, items, departments, canAdd: !addFirms || addFirms.length > 0 };
}

// One right in the firm of an existing request.
async function requireRequestRight(user: User, id: number, action: "edit" | "delete") {
  const row = await env.DB.prepare("SELECT company_id FROM work_requests WHERE id = ?").bind(id).first<{ company_id: number }>();
  if (!row) throw new Error("Sorğu tapılmadı.");
  if (!(await firmAccess(user, "tasks.requests")).firm(row.company_id)[action]) throw new Error("FORBIDDEN");
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.requests");
    const params = new URL(request.url).searchParams;
    if (params.get("summary")) return Response.json({ actionable: (await listFor(user)).items.filter((item) => item.actionable).length });
    const eventsFor = Number(params.get("events"));
    if (eventsFor) return Response.json({ events: await getRequestEvents(user, eventsFor) });
    return Response.json(await listFor(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğular açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "tasks.requests", "add");
    const body = await request.json();
    if (!(await firmAccess(user, "tasks.requests")).firm(Number(body.companyId)).add) throw new Error("FORBIDDEN");
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
    await requireRequestRight(user, Number(body.id), "edit");
    await updateRequest(user, { id: Number(body.id), action: String(body.action || ""), assigneeId: body.assigneeId ? Number(body.assigneeId) : undefined, agreedDueAt: body.agreedDueAt, text: body.text, score: body.score });
    return Response.json({ ...(await listFor(user)), events: await getRequestEvents(user, Number(body.id)) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "tasks.requests", "delete");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await requireRequestRight(user, id, "delete");
    await deleteRequest(user, id);
    return Response.json(await listFor(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu silinmədi." }, { status: 400 }); }
}
