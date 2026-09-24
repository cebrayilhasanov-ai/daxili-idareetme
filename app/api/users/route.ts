import { createUser, listUsers, requireUser, resetUserPassword, setUserActive } from "@/lib/auth";
import { createEmployee } from "@/db/catalog";
import { env } from "@/lib/runtime";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try { await requireUser(request, "admin"); return Response.json({ users: await listUsers() }); }
  catch { return Response.json({ error: "İcazə yoxdur." }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const existing = await env.DB.prepare("SELECT id FROM employees WHERE lower(email) = ?").bind(email).first<{ id: number }>();
    let employeeId = existing?.id;
    const companyIds: number[] = Array.isArray(body.companyIds) ? body.companyIds.map(Number).filter(Boolean) : [];
    if (!employeeId) {
      employeeId = await createEmployee({ name: body.name, position: body.position || "Personal", email, companyIds, companyPositions: body.companyPositions && typeof body.companyPositions === "object" ? body.companyPositions : undefined, avatarKey: body.avatarKey || undefined });
    }
    await createUser({ name: body.name, email, password: body.password, role: "employee", employeeId });
    await logAudit(user, "İstifadəçi hesabı yaradıldı", "user", email);
    return Response.json({ users: await listUsers() });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "İstifadəçi yaradılmadı." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, "admin");
    const body = await request.json();
    if (body.password) { await resetUserPassword(Number(body.id), String(body.password)); await logAudit(user, "İstifadəçi şifrəsi sıfırlandı", "user", `#${body.id}`); }
    else { await setUserActive(Number(body.id), Boolean(body.active)); await logAudit(user, body.active ? "İstifadəçi aktiv edildi" : "İstifadəçi deaktiv edildi", "user", `#${body.id}`); }
    return Response.json({ users: await listUsers() });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "İstifadəçi yenilənmədi." }, { status: 400 }); }
}
