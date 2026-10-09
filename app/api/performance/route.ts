import { getPerformanceData } from "@/db/catalog";
import { requireUser } from "@/lib/auth";

// Versiya 3.12: Ana səhifə → "Mənim performansım". Everyone sees only their own; the admin (who has no card of their own) sees an
// employee's only while viewing the program as that employee.
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const asked = Number(new URL(request.url).searchParams.get("employeeId")) || null;
    const employeeId = user.role === "admin" ? asked : user.employeeId;
    if (!employeeId) return Response.json({ none: true });
    return Response.json(await getPerformanceData(employeeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    return Response.json({ error: message || "Performans məlumatı açıla bilmədi." }, { status: 500 });
  }
}
