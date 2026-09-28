import { createDocumentTemplate, deleteDocumentTemplate, getDocumentStorage, getDocumentTemplates, setDocumentRoot, updateDocumentTemplate } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    // Şablonlar is admin-only; employees read the list only through Çıxan Sənədlər (to download a template while writing).
    if (user.role !== "admin") await requireSection(user, "documents.outgoing");
    return Response.json({ items: await getDocumentTemplates(), storage: user.role === "admin" ? await getDocumentStorage() : undefined });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    await createDocumentTemplate(body);
    await logAudit(user, "Sənəd şablonu yaradıldı", "document", body.name);
    return Response.json({ items: await getDocumentTemplates() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    if (body.action === "storage") {
      await setDocumentRoot(String(body.root || ""));
      await logAudit(user, "Sənədlərin kök papkası dəyişdirildi", "document", String(body.root || "—"));
      return Response.json({ items: await getDocumentTemplates(), storage: await getDocumentStorage() });
    }
    await updateDocumentTemplate({ ...body, id: Number(body.id) });
    await logAudit(user, "Sənəd şablonu yeniləndi", "document", body.name || `#${body.id}`);
    return Response.json({ items: await getDocumentTemplates() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteDocumentTemplate(id);
    await logAudit(user, "Sənəd şablonu silindi", "document", `#${id}`);
    return Response.json({ items: await getDocumentTemplates() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 500 }); }
}
