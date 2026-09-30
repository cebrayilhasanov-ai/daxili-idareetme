import {
  countIncomingForDirector, createCustomer, createIncomingDocument, createIncomingRequest, deleteIncomingDocument, directIncomingDocument, findCustomerByVoen,
  getIncomingDocuments, reviewIncomingDocument, updateIncomingDocument,
} from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// Daxil Olan Sənədlər (Versiya 2.59): registering needs the section permission; seeing a document, the director's look and
// tasks, and raising a request from it are decided per document (db/catalog.ts, incomingRights) — so department members and
// the director reach it without the permission.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

async function listResponse(user: Awaited<ReturnType<typeof requireUser>>) {
  return Response.json(await getIncomingDocuments(user));
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const user = await requireUser(request);
    // The menu badge: documents waiting for this director's look.
    if (params.get("summary")) return Response.json({ pending: await countIncomingForDirector(user) });
    if (params.has("voen")) {
      await requireSection(user, "documents.incoming");
      return Response.json({ customer: await findCustomerByVoen(String(params.get("voen"))) });
    }
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    // A related department raises a request on the document (checked per document).
    if (body.action === "request") {
      const requestId = await createIncomingRequest(user, { id: Number(body.id), toDepartment: String(body.toDepartment || ""), title: String(body.title || ""), description: body.description, dueDate: body.dueDate || undefined });
      await logAudit(user, "Daxil olan sənəd üzrə sorğu yaradıldı", "incoming-document", `#${body.id} → ${body.toDepartment}`);
      return Response.json({ ...(await (await listResponse(user)).json()), requestId });
    }
    await requireSection(user, "documents.incoming");
    // A sender whose VÖEN is not in the customer list gets its card created right from the registration form.
    if (body.action === "customer") {
      const customer = body.customer || {};
      await createCustomer(customer);
      await logAudit(user, "Müştəri yaradıldı", "customer", String(customer.name || ""));
      return Response.json({ customer: await findCustomerByVoen(String(customer.voen || "")) });
    }
    const created = await createIncomingDocument(user, { ...body, companyId: Number(body.companyId) });
    await logAudit(user, "Daxil olan sənəd qeydə alındı", "incoming-document", `#${created.incomingNo} ${body.senderName || ""}`.trim());
    const response = await listResponse(user);
    return Response.json({ ...(await response.json()), id: created.id });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd qeydə alınmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const id = Number(body.id);
    if (body.action === "review") {
      await reviewIncomingDocument(user, { id, note: body.note });
      await logAudit(user, "Rəhbər daxil olan sənədlə tanış oldu", "incoming-document", `#${id}`);
    } else if (body.action === "direct") {
      const targets = await directIncomingDocument(user, { id, departments: Array.isArray(body.departments) ? body.departments.map(String) : [], employees: Array.isArray(body.employees) ? body.employees.map(Number) : [], dueDate: body.dueDate || undefined, resolution: body.resolution });
      await logAudit(user, "Rəhbər daxil olan sənəd üzrə tapşırıq verdi", "incoming-document", `#${id} → ${targets.map((t) => `${t.head.name} (${t.department})`).join(", ")}`);
    } else {
      await updateIncomingDocument(user, { ...body, id });
      await logAudit(user, "Daxil olan sənəd yeniləndi", "incoming-document", `#${id}`);
    }
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd yenilənmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteIncomingDocument(user, id);
    await logAudit(user, "Daxil olan sənəd silindi", "incoming-document", `#${id}`);
    return await listResponse(user);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sənəd silinmədi." }, { status: 400 }); }
}
