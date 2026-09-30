import { canRegisterOutgoing, createOutgoingDocument, deleteOutgoingDocument, getOutgoingDocuments, recordApproval, updateOutgoingDocument } from "@/db/catalog";

// Çıxan Sənədlər (Versiya 2.60): registering needs the section permission; seeing, editing and deleting are decided per document
// (db/catalog.ts, outgoingRights) — department members and the director see their documents without the permission.
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

async function listBody(user: Awaited<ReturnType<typeof requireUser>>) {
  return { items: await getOutgoingDocuments(user), canRegister: await canRegisterOutgoing(user) };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    // Anyone who holds the Çıxan Sənədlər permission registers documents for their own firms.
    const user = await requireSection(await requireUser(request), "documents.outgoing");
    const body = await request.json();
    const created = await createOutgoingDocument(user, { ...body, companyId: Number(body.companyId) });
    await logAudit(user, "Çıxan sənəd yaradıldı", "outgoing-document", `#${created.outgoingNo} ${body.documentType || body.organizationName || ""}`.trim());
    return Response.json({ ...(await listBody(user)), id: created.id });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    if (body.action === "approve" || body.action === "return") {
      const level = body.level === "department" ? "department" : "director";
      await recordApproval(user, { kind: "outgoing", id: Number(body.id), action: body.action, level, department: body.department, note: body.note });
      await logAudit(user, body.action === "return" ? "Çıxan sənəd rəhbər tərəfindən geri qaytarıldı" : level === "department" ? "Çıxan sənədi şöbə təsdiqlədi" : "Çıxan sənədi rəhbər təsdiqlədi", "outgoing-document", `#${body.id}${body.department ? ` (${body.department})` : ""}`);
      return Response.json(await listBody(user));
    }
    await updateOutgoingDocument(user, { ...body, id: Number(body.id), companyId: body.companyId ? Number(body.companyId) : undefined });
    await logAudit(user, "Çıxan sənəd yeniləndi", "outgoing-document", `#${body.id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteOutgoingDocument(user, id);
    await logAudit(user, "Çıxan sənəd silindi", "outgoing-document", `#${id}`);
    return Response.json(await listBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 500 }); }
}
