import { createOutgoingDocument, deleteOutgoingDocument, getOutgoingDocuments, updateOutgoingDocument } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

// "" clears the link, a missing field leaves it as it is.
function replyTarget(value: unknown) {
  if (value === undefined) return undefined;
  return Number(value) || null;
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.outgoing");
    return Response.json({ items: await getOutgoingDocuments(user) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    // Anyone who may open Çıxan Sənədlər registers documents for their own firms; editing and deleting stay with the admin.
    const user = await requireSection(await requireUser(request), "documents.outgoing");
    const body = await request.json();
    const created = await createOutgoingDocument(user, { ...body, companyId: Number(body.companyId), replyToIncomingId: replyTarget(body.replyToIncomingId) });
    await logAudit(user, "Çıxan sənəd yaradıldı", "outgoing-document", `#${created.outgoingNo} ${body.documentType || body.organizationName || ""}`.trim());
    return Response.json({ items: await getOutgoingDocuments(user), id: created.id });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await updateOutgoingDocument({ ...body, id: Number(body.id), companyId: body.companyId ? Number(body.companyId) : undefined, replyToIncomingId: replyTarget(body.replyToIncomingId) });
    await logAudit(user, "Çıxan sənəd yeniləndi", "outgoing-document", `#${body.id}`);
    return Response.json({ items: await getOutgoingDocuments(user) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteOutgoingDocument(id);
    await logAudit(user, "Çıxan sənəd silindi", "outgoing-document", `#${id}`);
    return Response.json({ items: await getOutgoingDocuments(user) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 500 }); }
}
