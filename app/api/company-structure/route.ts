import { createStructurePosition, deleteStructurePosition, getCompanyStructure, updateStructurePosition } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { companyDepartments } from "@/db/requests";
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
    const companyId = Number(new URL(request.url).searchParams.get("companyId"));
    if (!companyId) return Response.json({ error: "Firma seçilməyib." }, { status: 400 });
    // ?members=1 (Versiya 2.75): the people of each department too — e.g. to pick who takes an outgoing document out.
    if (new URL(request.url).searchParams.get("members")) {
      const [items, structure] = await Promise.all([getCompanyStructure(companyId), companyDepartments()]);
      const members = structure.departmentsOf(companyId).flatMap((d) => structure.membersOf(companyId, d.name).map((m) => ({ id: m.id, name: m.name, department: d.name })));
      return Response.json({ items, members });
    }
    return Response.json({ items: await getCompanyStructure(companyId) });
  } catch (error) { return authError(error) || Response.json({ error: "Struktur açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    const items = await createStructurePosition({ companyId: Number(body.companyId), department: String(body.department || ""), title: String(body.title || ""), reportsTo: body.reportsTo });
    await logAudit(user, "Struktura vəzifə əlavə edildi", "company", `#${body.companyId}`);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Vəzifə əlavə olunmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    await requireUser(request, "admin");
    const body = await request.json();
    const items = await updateStructurePosition({ id: Number(body.id), department: body.department, title: body.title, reportsTo: body.reportsTo });
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Vəzifə yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "Silinəcək vəzifə seçilməyib." }, { status: 400 });
    const items = await deleteStructurePosition(id);
    return Response.json({ items });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Vəzifə silinmədi." }, { status: 500 }); }
}
