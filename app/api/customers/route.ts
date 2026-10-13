import { createCustomer, deleteCustomer, getCustomerDocuments, getCustomers, updateCustomer } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireAction, requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "dashboard.customers");
    // A customer's history (Versiya 2.86): only the documents this user may see in Çıxan / Daxil olan sənədlər.
    if (new URL(request.url).searchParams.get("documents") === "1") return Response.json({ documents: await getCustomerDocuments(user) });
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Siyahı açıla bilmədi." }, { status: 500 }); }
}

// Versiya 3.24: customers from an Excel file — the admin alone. The page reads the file and sends its rows in parts; each row is
// saved by the same rules as a customer added by hand. A row with a mistake, or with a VÖEN/FİN already in the system, is left
// out and returned with its reason; the rest are saved.
const LOCAL_TAX_RULES: Record<string, { pattern: RegExp; hint: string }> = {
  "Hüquqi şəxs": { pattern: /^\d{10}$/, hint: "VÖEN 10 rəqəm olmalıdır." },
  "Fərdi sahibkar": { pattern: /^\d{10}$/, hint: "VÖEN 10 rəqəm olmalıdır." },
  "Fiziki şəxs": { pattern: /^[A-Za-z0-9]{7}$/, hint: "FİN 7 simvol (hərf və rəqəm) olmalıdır." },
};
const MAX_IMPORT_ROWS = 200;
type ImportRow = { row?: unknown; entityType?: unknown; country?: unknown; voen?: unknown; name?: unknown; legalAddress?: unknown; manager?: unknown; phone?: unknown };

async function importCustomers(rows: ImportRow[]) {
  const created: number[] = [];
  const skipped: { row: number; error: string }[] = [];
  for (const raw of rows) {
    const row = Number(raw.row) || 0;
    const text = (value: unknown) => String(value ?? "").trim();
    const input = { entityType: text(raw.entityType), country: text(raw.country), voen: text(raw.voen), name: text(raw.name), legalAddress: text(raw.legalAddress), manager: text(raw.manager), phone: text(raw.phone) };
    try {
      const local = LOCAL_TAX_RULES[input.entityType];
      if (!local && input.entityType !== "Xarici təchizatçı") throw new Error("Statusu düzgün deyil.");
      if (local && input.voen && !local.pattern.test(input.voen)) throw new Error(local.hint);
      await createCustomer(input);
      created.push(row);
    } catch (error) { skipped.push({ row, error: error instanceof Error ? error.message : "Müştəri əlavə olunmadı." }); }
  }
  return { created, skipped };
}

export async function POST(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("import") === "1") {
      const user = await requireUser(request);
      if (user.role !== "admin") throw new Error("FORBIDDEN");
      const body = await request.json();
      const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : [];
      if (!rows.length) return Response.json({ error: "Yüklənəcək sətir yoxdur." }, { status: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return Response.json({ error: `Bir dəfəyə ən çox ${MAX_IMPORT_ROWS} sətir göndərilə bilər.` }, { status: 400 });
      const result = await importCustomers(rows);
      if (result.created.length) await logAudit(user, "Müştərilər Excel faylından yükləndi", "customer", `${result.created.length} müştəri əlavə edildi${result.skipped.length ? `, ${result.skipped.length} sətir buraxıldı` : ""}`);
      return Response.json({ ...result, items: await getCustomers() });
    }
    // Rights (Versiya 2.62): adding is open by default, editing and deleting only when the admin grants them.
    const user = await requireAction(await requireUser(request), "dashboard.customers", "add");
    const body = await request.json();
    await createCustomer(body);
    await logAudit(user, "Müştəri yaradıldı", "customer", body.name);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri əlavə olunmadı." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "dashboard.customers", "edit");
    const body = await request.json();
    await updateCustomer({ ...body, id: Number(body.id) });
    await logAudit(user, "Müştəri yeniləndi", "customer", body.name || `#${body.id}`);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri yenilənmədi." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAction(await requireUser(request), "dashboard.customers", "delete");
    const id = Number(new URL(request.url).searchParams.get("id"));
    await deleteCustomer(id);
    await logAudit(user, "Müştəri silindi", "customer", `#${id}`);
    return Response.json({ items: await getCustomers() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Müştəri silinmədi." }, { status: 500 }); }
}
