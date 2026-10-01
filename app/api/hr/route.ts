import { createHrCustomer, deleteHrCalendarDay, deleteHrEducation, deleteHrEmployee, deleteHrFamilyMember, deleteHrLeave, getHrCustomerReport, saveHrEducation, saveHrFamilyMember, saveHrMaritalStatus, fillHrSalaries, getHrData, hrEmployeeLabel, saveHrCalendarDay, saveHrEmployee, saveHrLeave, saveHrParams, saveHrSalary, seedHrCalendar } from "@/db/hr";
import { requireUser } from "@/lib/auth";
import { requireAction, requireAnyAction, requireSection, sectionRights } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

// HR register: the admin, and employees the admin has explicitly given "Personallar" (closed by default).
// Rights (Versiya 2.62): Əlavə et — a new worker card; Dəyişiklik et — everything inside a card (leave, family, education,
// salaries, removing those rows), the calendar and the calculation parameters; Sil — deleting a whole worker card.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

async function hrUser(request: Request) {
  return requireSection(await requireUser(request), "hr.personnel");
}

// Every answer carries the viewer's rights, so the page offers only what is allowed.
async function hrBody(user: Awaited<ReturnType<typeof requireUser>>, extra: Record<string, unknown> = {}) {
  const [data, rights] = await Promise.all([getHrData(), sectionRights(user, "hr.personnel")]);
  return { ...data, rights: { add: rights.add, edit: rights.edit, delete: rights.delete }, ...extra };
}

export async function GET(request: Request) {
  try {
    const user = await hrUser(request);
    if (new URL(request.url).searchParams.get("report") === "customers") return Response.json({ rows: await getHrCustomerReport() });
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "HR məlumatları açılmadı." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await hrUser(request);
    const body = await request.json();
    if (body.action === "customer") await requireAnyAction(user, "hr.personnel", ["add", "edit"]);
    else await requireAction(user, "hr.personnel", body.action === "employee" && !body.id ? "add" : "edit");
    if (body.action === "employee") {
      const id = await saveHrEmployee(body);
      await logAudit(user, body.id ? "HR: işçi kartı yeniləndi" : "HR: işçi əlavə edildi", "hr_employee", `${body.lastName || ""} ${body.firstName || ""}`.trim() || `#${id}`);
      return Response.json(await hrBody(user, { savedId: id }));
    }
    if (body.action === "customer") {
      const customerId = await createHrCustomer(body.customer || {});
      await logAudit(user, "Müştəri yaradıldı (HR, əvvəlki iş yeri)", "customer", String(body.customer?.name || ""));
      return Response.json(await hrBody(user, { customerId }));
    }
    if (body.action === "leave") await saveHrLeave(body);
    else if (body.action === "marital") await saveHrMaritalStatus(body);
    else if (body.action === "family") await saveHrFamilyMember(body);
    else if (body.action === "education") await saveHrEducation(body);
    else if (body.action === "salary") await saveHrSalary(body);
    else if (body.action === "salary-fill") await fillHrSalaries(Number(body.hrEmployeeId), Number(body.months) || 12);
    else if (body.action === "calendar-day") await saveHrCalendarDay(body);
    else if (body.action === "calendar-seed") await seedHrCalendar(Number(body.year));
    else if (body.action === "params") { await saveHrParams(body.params); await logAudit(user, "HR: hesablama parametrləri dəyişdirildi", "hr_settings", null); }
    else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat saxlanmadı." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const user = await hrUser(request);
    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    await requireAction(user, "hr.personnel", type === "employee" ? "delete" : "edit");
    if (type === "employee") {
      const id = Number(params.get("id"));
      if (!id) return Response.json({ error: "İşçi seçilməyib." }, { status: 400 });
      const label = await hrEmployeeLabel(id);
      await deleteHrEmployee(id);
      await logAudit(user, "HR: işçi kartı silindi", "hr_employee", label);
    } else if (type === "leave") await deleteHrLeave(Number(params.get("id")));
    else if (type === "family") await deleteHrFamilyMember(Number(params.get("id")));
    else if (type === "education") await deleteHrEducation(Number(params.get("id")));
    else if (type === "calendar") await deleteHrCalendarDay(String(params.get("date") || ""));
    else return Response.json({ error: "Silinəcək məlumat seçilməyib." }, { status: 400 });
    return Response.json(await hrBody(user));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Silinmədi." }, { status: 500 }); }
}
