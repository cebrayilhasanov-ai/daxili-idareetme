import { createInternalDocument, deleteInternalDocument, findCustomerByVoen, getInternalDocuments, updateInternalDocument } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireAction, requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// Şirkətdaxili sənədlər (Versiya 3.51): registering needs the section permission; seeing a document is decided per document
// (db/catalog.ts, internalRights) — so the director, the related departments' heads and the responsible person reach it without it.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  // The same number of the same type in the firm: the page asks and, if the user agrees, sends allowDuplicate.
  if (message.startsWith("DUPLICATE:")) return Response.json({ error: message.slice("DUPLICATE:".length), duplicate: true }, { status: 409 });
  return null;
}

async function listResponse(user: Awaited<ReturnType<typeof requireUser>>) {
  return Response.json(await getInternalDocuments(user));
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const user = await requireUser(request);
    if (params.has("voen")) {
      await requireSection(user, "documents.internal");
      return Response.json({ customer: await findCustomerByVoen(String(params.get("voen"))) });
    }
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "documents.internal", "add");
    const body = await request.json();
    const created = await createInternalDocument(user, body);
    await logAudit(user, "Şirkətdaxili sənəd qeydə alındı", "internal-document", `${body.documentType || ""} №${created.documentNo}`.trim());
    const response = await listResponse(user);
    return Response.json({ ...(await response.json()), id: created.id });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd qeydə alınmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const id = Number(body.id);
    await updateInternalDocument(user, { ...body, id });
    await logAudit(user, "Şirkətdaxili sənəd yeniləndi", "internal-document", `#${id}`);
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteInternalDocument(user, id);
    await logAudit(user, "Şirkətdaxili sənəd silindi", "internal-document", `#${id}`);
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 400 }); }
}
