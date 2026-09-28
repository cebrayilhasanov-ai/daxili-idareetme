import { assignIncomingDocument, createIncomingDocument, deleteIncomingDocument, getDocumentStorage, getIncomingDocuments, getIncomingSettings, setIncomingSettings, updateIncomingDocument } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

async function listResponse(user: Awaited<ReturnType<typeof requireUser>>) {
  const { items, assignees } = await getIncomingDocuments(user);
  return Response.json({ items, assignees, settings: user.role === "admin" ? { ...(await getIncomingSettings()), folderSaving: (await getDocumentStorage()).folderSaving } : undefined });
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.incoming");
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

// Anyone who may open Daxil Olan Sənədlər registers documents for their own firms; editing and deleting stay with the admin.
export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.incoming");
    const body = await request.json();
    const created = await createIncomingDocument(user, { ...body, companyId: Number(body.companyId) });
    await logAudit(user, "Daxil olan sənəd qeydə alındı", "incoming-document", `#${created.incomingNo} ${body.senderName || ""}`.trim());
    const response = await listResponse(user);
    return Response.json({ ...(await response.json()), id: created.id });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd qeydə alınmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.incoming");
    const body = await request.json();
    if (body.action === "assign") {
      await assignIncomingDocument(user, { id: Number(body.id), assigneeId: Number(body.assigneeId) || undefined, dueDate: body.dueDate || undefined, resolution: body.resolution, infoOnly: Boolean(body.infoOnly) });
      await logAudit(user, body.infoOnly ? "Daxil olan sənəd məlumat üçün qeyd edildi" : "Daxil olan sənəd icraya verildi", "incoming-document", `#${body.id}`);
      return await listResponse(user);
    }
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    if (body.action === "settings") {
      await setIncomingSettings({ folder: body.folder, namePattern: body.namePattern });
      await logAudit(user, "Daxil olan sənədlərin papka qaydası dəyişdirildi", "incoming-document", String(body.folder || "—"));
      return await listResponse(user);
    }
    await updateIncomingDocument({ ...body, id: Number(body.id) });
    await logAudit(user, "Daxil olan sənəd yeniləndi", "incoming-document", `#${body.id}`);
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteIncomingDocument(id, user.name);
    await logAudit(user, "Daxil olan sənəd silindi", "incoming-document", `#${id}`);
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 400 }); }
}
