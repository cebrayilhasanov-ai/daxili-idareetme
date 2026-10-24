import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";
import { firmAccess } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { companyDepartments } from "@/db/requests";
import { companyLabel, getPayrollMonth, isPeriod, savePayrollInputs, saveTimesheetMarks, setPayrollStatus, setTimesheetStatus, type PayrollAccess } from "@/db/payroll";
import { todayIso } from "@/lib/hr-calc";

// Kadrlar → Əməkhaqqı cədvəlləri (Versiya 3.54). A department head fills the tabel of the departments they head (Firmalar →
// Struktur) with no extra right. Giriş icazələri → Əməkhaqqı cədvəlləri (hr.payroll, closed by default, per firm) gives the
// payroll accountant "Bütün şöbələrin tabeli" (see / change every department's tabel, accept or send it back) and
// "Əməkhaqqı cədvəli" (see / fill and approve the payroll). Salaries leave the server only with the payroll's Baxış.

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

type User = Awaited<ReturnType<typeof requireUser>>;

async function firmsOf(user: User) {
  const [structure, payroll] = await Promise.all([companyDepartments(), firmAccess(user, "hr.payroll")]);
  const companies = user.role === "admin"
    ? (await env.DB.prepare("SELECT id, name FROM companies WHERE active = 1 ORDER BY name").all<{ id: number; name: string }>()).results
    : user.employeeId ? (await env.DB.prepare("SELECT companies.id, companies.name FROM employee_companies JOIN companies ON companies.id = employee_companies.company_id WHERE employee_companies.employee_id = ? AND companies.active = 1 ORDER BY companies.name").bind(user.employeeId).all<{ id: number; name: string }>()).results : [];
  return companies.map((c) => {
    const r = payroll.firm(c.id);
    const parts = r.view ? r.parts : null;
    const payView = Boolean(parts?.payroll?.view);
    const access: PayrollAccess = {
      // The payroll needs every worker of the firm, so its Baxış also shows every department's tabel (read-only).
      allDepartments: Boolean(parts?.timesheet?.view) || payView,
      editAll: Boolean(parts?.timesheet?.edit),
      heads: user.role === "admin" ? [] : structure.headedBy(c.id, user.employeeId),
      payView,
      payEdit: Boolean(parts?.payroll?.edit),
    };
    return { id: c.id, name: c.name, access };
  }).filter((f) => f.access.allDepartments || f.access.heads.length);
}

async function monthBody(user: User, companyIdRaw: unknown, periodRaw: unknown) {
  const firms = await firmsOf(user);
  const period = isPeriod(periodRaw) ? periodRaw : todayIso().slice(0, 7);
  const firm = firms.find((f) => f.id === Number(companyIdRaw)) || firms[0];
  if (!firm) return { firms: [], period, companyId: null, access: null };
  return { firms: firms.map(({ id, name }) => ({ id, name })), period, companyId: firm.id, access: firm.access, ...(await getPayrollMonth(firm.id, period, firm.access)) };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    return Response.json(await monthBody(user, params.get("companyId"), params.get("period")));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Əməkhaqqı cədvəlləri açılmadı." }, { status: 500 }); }
}

const STATUS_LABELS: Record<string, string> = { submit: "təqdim edildi", accept: "qəbul edildi", return: "geri qaytarıldı", reopen: "qəbulu ləğv edildi" };

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const period = String(body.period || "");
    if (!isPeriod(period)) return Response.json({ error: "Ay düzgün seçilməyib." }, { status: 400 });
    const firm = (await firmsOf(user)).find((f) => f.id === Number(body.companyId));
    if (!firm) throw new Error("FORBIDDEN");
    const where = `${await companyLabel(firm.id)}, ${period}`;
    if (body.action === "marks") await saveTimesheetMarks(user, firm.id, period, body.rows, firm.access);
    else if (body.action === "status") {
      const department = String(body.department ?? "").trim();
      await setTimesheetStatus(user, firm.id, period, department, String(body.status || ""), body.note, firm.access);
      await logAudit(user, `Kadrlar: tabel ${STATUS_LABELS[String(body.status)] || "dəyişdirildi"}`, "hr_timesheet", `${where}, ${department || "Şöbə göstərilməyib"}${body.status === "return" ? ` — ${String(body.note || "")}` : ""}`);
    } else if (body.action === "inputs") await savePayrollInputs(firm.id, period, body.rows, firm.access);
    else if (body.action === "approve" || body.action === "unapprove") {
      await setPayrollStatus(user, firm.id, period, body.action === "approve", firm.access);
      await logAudit(user, body.action === "approve" ? "Kadrlar: əməkhaqqı cədvəli təsdiqləndi" : "Kadrlar: əməkhaqqı cədvəlinin təsdiqi ləğv edildi", "hr_payroll", where);
    } else return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
    return Response.json(await monthBody(user, firm.id, period));
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Məlumat saxlanmadı." }, { status: 400 }); }
}
