import { requireUser } from "@/lib/auth";
import { env } from "@/lib/runtime";
import { companyDepartments } from "@/db/requests";

// Təlimatlar (Versiya 2.78): whether the viewer heads a department or is a firm's director, so the guides show them the parts
// meant for heads and directors. The admin may ask it for the employee they are viewing as (?employeeId=).
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const asked = Number(new URL(request.url).searchParams.get("employeeId")) || null;
    const employeeId = user.role === "admin" && asked ? asked : user.employeeId;
    if (!employeeId || !env.DB) return Response.json({ head: false, director: false });
    const firms = (await env.DB.prepare("SELECT company_id FROM employee_companies WHERE employee_id = ?").bind(employeeId).all<{ company_id: number }>()).results.map((r) => r.company_id);
    const structure = await companyDepartments();
    return Response.json({
      head: firms.some((companyId) => structure.headedBy(companyId, employeeId).length > 0),
      director: firms.some((companyId) => structure.directorsOf(companyId).has(employeeId)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    return Response.json({ error: "Məlumat alınmadı." }, { status: 500 });
  }
}
