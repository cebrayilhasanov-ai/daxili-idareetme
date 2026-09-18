import { createOutgoingDocument, deleteOutgoingDocument, getOutgoingDocuments, updateOutgoingDocument } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return Response.json({ items: await getOutgoingDocuments() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await createOutgoingDocument(body);
    await logAudit(user, "Çıxan sənəd yaradıldı", "outgoing-document", body.outgoingNo);
    return Response.json({ items: await getOutgoingDocuments() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await updateOutgoingDocument({ ...body, id: Number(body.id) });
    await logAudit(user, "Çıxan sənəd yeniləndi", "outgoing-document", body.outgoingNo || `#${body.id}`);
    return Response.json({ items: await getOutgoingDocuments() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteOutgoingDocument(id);
    await logAudit(user, "Çıxan sənəd silindi", "outgoing-document", `#${id}`);
    return Response.json({ items: await getOutgoingDocuments() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 500 }); }
}
