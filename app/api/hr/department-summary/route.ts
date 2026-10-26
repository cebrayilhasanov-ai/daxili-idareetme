import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";
import { companyDepartments } from "@/db/requests";
import { todayIso } from "@/lib/hr-calc";

// Ana səhifə → "Şöbəm" (Versiya 3.59): each department head sees, for the departments they head (Firmalar → Struktur), the
// number of personnel working today and the sum of their monthly salaries from the Personallar cards — totals only, never a
// person's salary. The firm's director (and the admin) sees every department of the firm. No extra right is needed.

type Row = { company_id: number; department: string | null; people: number; salary: number | null };

export async function GET() {
  try {
    const user = await requireUser();
    const companies = user.role === "admin"
      ? (await env.DB.prepare("SELECT id, name FROM companies WHERE active = 1 ORDER BY name").all<{ id: number; name: string }>()).results
      : user.employeeId ? (await env.DB.prepare("SELECT companies.id, companies.name FROM employee_companies JOIN companies ON companies.id = employee_companies.company_id WHERE employee_companies.employee_id = ? AND companies.active = 1 ORDER BY companies.name").bind(user.employeeId).all<{ id: number; name: string }>()).results : [];
    if (!companies.length) return Response.json({ firms: [] });
    const structure = await companyDepartments();
    const scopes = companies.map((c) => {
      const director = user.role === "admin" || Boolean(user.employeeId && structure.directorsOf(c.id).has(user.employeeId));
      return { ...c, director, departments: director ? null : new Set(structure.headedBy(c.id, user.employeeId)) };
    }).filter((c) => c.director || c.departments!.size);
    if (!scopes.length) return Response.json({ firms: [] });
    const today = todayIso();
    let rows: Row[] = [];
    try {
      rows = (await env.DB.prepare(`SELECT company_id, TRIM(COALESCE(department, '')) AS department, COUNT(*) AS people, SUM(COALESCE(monthly_salary, 0)) AS salary FROM hr_employees
        WHERE company_id IN (${scopes.map(() => "?").join(",")}) AND hire_date <= ? AND (termination_date IS NULL OR termination_date = '' OR termination_date >= ?)
        GROUP BY company_id, TRIM(COALESCE(department, ''))`).bind(...scopes.map((c) => c.id), today, today).all<Row>()).results;
    } catch { rows = []; }
    const firms = scopes.map((c) => {
      const own = rows.filter((r) => r.company_id === c.id);
      // A head's department with nobody on the cards yet is still shown (0 people).
      const names = c.director ? [...new Set([...structure.departmentsOf(c.id).map((d) => d.name.trim()), ...own.map((r) => r.department || "")])] : [...c.departments!];
      const departments = names.map((name) => {
        const r = own.find((x) => (x.department || "") === name.trim());
        return { name, people: Number(r?.people || 0), salary: Math.round(Number(r?.salary || 0) * 100) / 100 };
      }).filter((d) => !c.director || d.people > 0).sort((a, b) => a.name.localeCompare(b.name, "az"));
      return { id: c.id, name: c.name, director: c.director, departments };
    }).filter((f) => f.departments.length);
    return Response.json({ firms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    return Response.json({ error: "Məlumat alınmadı." }, { status: 500 });
  }
}
