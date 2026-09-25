import { getPersonalWorkHistory } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { env } from "@/lib/runtime";

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "tasks.mine");
    const personalWorkId = Number(new URL(request.url).searchParams.get("personalWorkId"));
    if (!personalWorkId) throw new Error("İş seçilməyib.");
    if (user.role !== "admin") {
      const work = await env.DB.prepare("SELECT user_id FROM personal_works WHERE id = ?").bind(personalWorkId).first<{ user_id: number }>();
      if (!work || work.user_id !== user.id) throw new Error("FORBIDDEN");
    }
    return Response.json({ events: await getPersonalWorkHistory(personalWorkId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    return Response.json({ error: message || "Tarixçə yüklənmədi." }, { status: 500 });
  }
}
