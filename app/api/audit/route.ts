import { requireUser } from "@/lib/auth";
import { listAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    await requireUser(request, "admin");
    return Response.json({ items: await listAuditLog() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    return Response.json({ error: "Tarixçə yüklənmədi." }, { status: 500 });
  }
}
