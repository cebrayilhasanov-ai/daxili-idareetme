import { createHrCustomer, deleteHrCalendarDay, deleteHrEducation, deleteHrEmployee, deleteHrFamilyMember, deleteHrLeave, getHrCustomerReport, saveHrEducation, saveHrFamilyMember, saveHrMaritalStatus, fillHrSalaries, getHrData, hrEmployeeLabel, hrSalaryExists, saveHrCalendarDay, saveHrEmployee, saveHrLeave, saveHrParams, saveHrSalary, seedHrCalendar, storedHrInput } from "@/db/hr";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireAction, requireSection, sectionRights, type SectionAction } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { PART_INPUTS, stripHrData } from "@/lib/hr-parts";
import { departmentScope, inScope, narrowScope, requireCardRowInScope, requireHrEmployeeInScope, scopeHrData } from "@/db/department-scope";

// HR register: the admin, and employees the admin has explicitly given "Personallar" (closed by default).
// Rights (Versiya 2.62): Əlavə et — a new worker card; Dəyişiklik et — the calendar and the calculation parameters; Sil —
// deleting a whole worker card. Since Versiya 3.19 everything inside a card has the rights of its part (lib/permission-model.ts
// SECTION_PARTS): a part that may not be seen is not sent at all (lib/hr-parts.ts), and on saving a card the stored values of
// the parts that may not be changed are kept whatever the page sends.
// Since Versiya 2.65 only the cards of the departments the user oversees (db/department-scope.ts) are shown and changed.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

// Versiya 2.99: the rights are per firm — each right reaches the cards of the firms where it is given; a part's right
// (Versiya 3.19) reaches the cards of the firms where that part's right is given.
async function hrContext(user: User) {
  const [scope, access] = await Promise.all([departmentScope(user), firmAccess(user, "hr.personnel")]);
  return {
    access,
    sectionScope: (action: SectionAction) => narrowScope(scope, access.firms(action)),
    partScope: (part: string, action: SectionAction) => narrowScope(scope, access.partFirms(part, action)),
  };
}

async function hrUser(request: Request) {
  return requireSection(await requireUser(request), "hr.personnel");
}

// Every answer carries the viewer's rights, so the page offers only what is allowed: the section's rights and, per firm,
// the rights in each part of the card (null for the admin — everything).
async function hrBody(user: User, extra: Record<string, unknown> = {}) {
  const [data, rights, ctx] = await Promise.all([getHrData(), sectionRights(user, "hr.personnel"), hrContext(user)]);
  const scoped = scopeHrData(data, ctx.sectionScope("view"));
  const visible = ctx.access.admin ? scoped : stripHrData(scoped, (companyId) => ctx.access.firm(companyId).parts);
  const partRights = ctx.access.admin ? null : Object.fromEntries(visible.companies.map((c) => [String((c as { id: number }).id), ctx.access.firm(Number((c as { id: number }).id)).parts]));
  return { ...visible, rights: { add: rights.add, edit: rights.edit, delete: rights.delete }, partRights, ...extra };
}

type Ctx = Awaited<ReturnType<typeof hrContext>>;
type JobInput = { id?: unknown; customerId?: unknown; position?: unknown; startDate?: unknown; endDate?: unknown; terminationReason?: unknown };
const sameJob = (a: JobInput, b: JobInput) => String(a.customerId ?? "") === String(b.customerId ?? "") && String(a.position ?? "").trim() === String(b.position ?? "").trim()
  && String(a.startDate ?? "") === String(b.startDate ?? "") && String(a.endDate ?? "") === String(b.endDate ?? "") && String(a.terminationReason ?? "") === String(b.terminationReason ?? "");

// The card as it may be saved: a new card takes only the parts the user sees in its firm; a saved card keeps the stored
// values of every part the user may not change, and its earlier employers change only as far as their rights go.
async function allowedCardInput(ctx: Ctx, body: Record<string, unknown>) {
  const id = Number(body.id) || 0;
  if (!id) {
    const parts = ctx.access.firm(Number(body.companyId)).parts;
    const input = { ...body };
    for (const [part, keys] of Object.entries(PART_INPUTS)) if (part !== "workplace" && part !== "personal" && !parts[part].view) for (const key of keys) input[key] = null;
    if (!parts.personal.view) for (const key of PART_INPUTS.personal) if (!["lastName", "firstName", "patronymic"].includes(key)) input[key] = null;
    if (!parts.workplace.view) input.userEmployeeId = null;
    if (!parts.priorJobs.view) input.priorJobs = [];
    return input;
  }
  await requireHrEmployeeInScope(ctx.sectionScope("view"), id);
  const stored = await storedHrInput(id);
  if (!stored) throw new Error("İşçi tapılmadı.");
  const parts = ctx.access.firm(Number(stored.companyId)).parts;
  const jobs = parts.priorJobs;
  if (!Object.values(parts).some((p) => p.edit) && !jobs.add && !jobs.delete) throw new Error("FORBIDDEN");
  const input: Record<string, unknown> = { ...body, id };
  for (const [part, keys] of Object.entries(PART_INPUTS)) if (!parts[part].edit) for (const key of keys) input[key] = stored[key];
  // Moving the card to another firm or department: only into a department overseen where İş yeri may be changed.
  if (parts.workplace.edit && (String(input.companyId ?? "") !== String(stored.companyId ?? "") || String(input.department ?? "").trim() !== String(stored.department ?? "").trim())) {
    const scope = ctx.partScope("workplace", "edit");
    if (!inScope(scope, input.companyId, input.department)) throw new Error(scope && (!input.companyId || !input.department) ? "Firma və şöbəni seçin." : "FORBIDDEN");
  }
  const before = stored.priorJobs as JobInput[];
  if (!jobs.view) input.priorJobs = before;
  else {
    const after = Array.isArray(body.priorJobs) ? (body.priorJobs as JobInput[]) : [];
    const byId = new Map(before.map((j) => [Number(j.id), j]));
    const kept = new Set<number>();
    for (const row of after) {
      const old = byId.get(Number(row.id));
      if (!old) { if (!jobs.add) throw new Error("Əvvəlki iş yeri əlavə etmək icazəniz yoxdur."); continue; }
      kept.add(Number(row.id));
      if (!sameJob(old, row) && !jobs.edit) throw new Error("Əvvəlki iş yerlərini dəyişmək icazəniz yoxdur.");
    }
    if (!jobs.delete && before.some((j) => !kept.has(Number(j.id)))) throw new Error("Əvvəlki iş yerini silmək icazəniz yoxdur.");
  }
  return input;
}

export async function GET(request: Request) {
  try {
    const user = await hrUser(request);
    if (new URL(request.url).searchParams.get("report") === "customers") {
      const ctx = await hrContext(user);
      const rows = (await getHrCustomerReport()) as Array<Record<string, unknown>>;
      if (ctx.access.admin) return Response.json({ rows });
      // Only the cards whose "Əvvəlki iş yerləri" the user may see.
      const employees = scopeHrData(await getHrData(), ctx.sectionScope("view")).employees as Array<{ id: number; company_id: number | null }>;
      const visible = new Set(employees.filter((e) => ctx.access.firm(Number(e.company_id)).parts.priorJobs.view).map((e) => e.id));
      return Response.json({ rows: rows.filter((r) => visible.has(Number(r.hr_employee_id))) });
    }
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Kadr məlumatları açılmadı." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await hrUser(request);
    const body = await request.json();
    const ctx = await hrContext(user);
    const employeeId = Number(body.hrEmployeeId);
    // One right of one part, on the card the row belongs to (and on the row itself when it is changed).
    const requirePart = async (part: string, action: SectionAction, row?: "leave" | "family" | "education") => {
      const scope = ctx.partScope(part, action);
      await requireHrEmployeeInScope(scope, employeeId);
      if (row && body.id) await requireCardRowInScope(scope, row, Number(body.id));
    };
    if (body.action === "employee") {
      if (!body.id) {
        await requireAction(user, "hr.personnel", "add");
        // A new card is saved only into a department the user oversees — in a firm where the right is given.
        const scope = ctx.sectionScope("add");
        if (!inScope(scope, body.companyId, body.department)) throw new Error(scope && (!body.companyId || !body.department) ? "Firma və şöbəni seçin." : "FORBIDDEN");
      }
      const input = await allowedCardInput(ctx, body);
      const id = await saveHrEmployee(input);
      await logAudit(user, body.id ? "Kadrlar: işçi kartı yeniləndi" : "Kadrlar: işçi əlavə edildi", "hr_employee", `${input.lastName || ""} ${input.firstName || ""}`.trim() || `#${id}`);
      return Response.json(await hrBody(user, { savedId: id }));
    }
    if (body.action === "customer") {
      // A new earlier employer: whoever may add a card, or add or change earlier employers somewhere.
      const may = ctx.access.admin || ctx.access.firms("add")!.length > 0 || ctx.access.partFirms("priorJobs", "add")!.length > 0 || ctx.access.partFirms("priorJobs", "edit")!.length > 0;
      if (!may) throw new Error("FORBIDDEN");
      const customerId = await createHrCustomer(body.customer || {});
      await logAudit(user, "Müştəri yaradıldı (Kadrlar, əvvəlki iş yeri)", "customer", String(body.customer?.name || ""));
      return Response.json(await hrBody(user, { customerId }));
    }
    if (body.action === "leave") { await requirePart("sick", body.id ? "edit" : "add", "leave"); await saveHrLeave(body); }
    else if (body.action === "marital") { await requirePart("family", "edit"); await saveHrMaritalStatus(body); }
    else if (body.action === "family") { await requirePart("family", body.id ? "edit" : "add", "family"); await saveHrFamilyMember(body); }
    else if (body.action === "education") { await requirePart("education", body.id ? "edit" : "add", "education"); await saveHrEducation(body); }
    else if (body.action === "salary") {
      const empty = body.amount === null || body.amount === undefined || String(body.amount).trim() === "";
      await requirePart("salary", empty ? "delete" : await hrSalaryExists(employeeId, String(body.period)) ? "edit" : "add");
      await saveHrSalary(body);
    } else if (body.action === "salary-fill") { await requirePart("salary", "add"); await fillHrSalaries(employeeId, Number(body.months) || 12); }
    else if (["calendar-day", "calendar-seed", "params"].includes(String(body.action))) {
      await requireAction(user, "hr.personnel", "edit");
      if (body.action === "calendar-day") await saveHrCalendarDay(body);
      else if (body.action === "calendar-seed") await seedHrCalendar(Number(body.year));
      else { await saveHrParams(body.params); await logAudit(user, "Kadrlar: hesablama parametrləri dəyişdirildi", "hr_settings", null); }
    }
    else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat saxlanmadı." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await hrUser(request);
    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    const id = Number(params.get("id"));
    const ctx = await hrContext(user);
    if (type === "employee") {
      await requireAction(user, "hr.personnel", "delete");
      await requireHrEmployeeInScope(ctx.sectionScope("delete"), id);
      if (!id) return Response.json({ error: "İşçi seçilməyib." }, { status: 400 });
      const label = await hrEmployeeLabel(id);
      await deleteHrEmployee(id);
      await logAudit(user, "Kadrlar: işçi kartı silindi", "hr_employee", label);
    } else if (type === "leave") { await requireCardRowInScope(ctx.partScope("sick", "delete"), "leave", id); await deleteHrLeave(id); }
    else if (type === "family") { await requireCardRowInScope(ctx.partScope("family", "delete"), "family", id); await deleteHrFamilyMember(id); }
    else if (type === "education") { await requireCardRowInScope(ctx.partScope("education", "delete"), "education", id); await deleteHrEducation(id); }
    else if (type === "calendar") { await requireAction(user, "hr.personnel", "edit"); await deleteHrCalendarDay(String(params.get("date") || "")); }
    else return Response.json({ error: "Silinəcək məlumat seçilməyib." }, { status: 400 });
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Silinmədi." }, { status: 500 }); }
}
