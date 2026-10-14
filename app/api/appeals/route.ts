import { appealSummary, createAppeal, markAppealAnswersSeen, fixedAppealMarks, getAppeals, noteAppeal, takeAppeal, withdrawAppeal } from "@/db/appeals";
import { parseFiles } from "@/db/attachments";
import { requireUser } from "@/lib/auth";
import { firmAccess, requireSection } from "@/lib/permissions";
import { env } from "@/lib/runtime";

// Versiya 3.27: "Rəhbərə müraciət". GET: both lists (?summary=1 — the bell's count; ?scope=fixed — the ✉ marks of fixed works).
// POST: send one (from a fixed work's period or a personal work's step). PATCH: the head takes it as a personal work (take) or
// closes it with a reply (note). DELETE: the sender takes it back while it is unread.
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    if (params.get("summary") === "1") return Response.json(await appealSummary(user));
    if (params.get("scope") === "fixed") return Response.json({ marks: await fixedAppealMarks(user) });
    return Response.json(await getAppeals(user));
  } catch (error) { return failure(error, "Müraciətlər yüklənmədi."); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const sourceType = String(body.sourceType || "");
    await requireSection(user, sourceType === "fixed" ? "tasks.fixed" : "tasks.mine");
    const id = await createAppeal(user, { sourceType, sourceId: Number(body.sourceId), periodKey: body.periodKey, periodLabel: body.periodLabel, title: String(body.title || ""), description: body.description ? String(body.description) : undefined, urgent: Boolean(body.urgent), files: parseFiles(body.files) });
    return Response.json({ id, ...(await getAppeals(user)) });
  } catch (error) { return failure(error, "Müraciət göndərilmədi."); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const id = Number(body.id);
    if (body.action === "take") {
      await requireSection(user, "tasks.mine");
      // The work goes into the appeal's firm, so Şəxsi işlərim must be open to the head there.
      const row = await env.DB.prepare("SELECT company_id FROM head_appeals WHERE id = ?").bind(id).first<{ company_id: number }>();
      const firms = (await firmAccess(user, "tasks.mine")).firms("view");
      if (row && firms && !firms.includes(Number(row.company_id))) throw new Error("Bu firmada Şəxsi işlərim bölməsi sizə açıq deyil.");
      const workId = await takeAppeal(user, id);
      return Response.json({ workId, ...(await getAppeals(user)) });
    }
    if (body.action === "seen") {
      await markAppealAnswersSeen(user);
      return Response.json({ ok: true });
    }
    if (body.action === "note") {
      await noteAppeal(user, id, String(body.reply || ""));
      return Response.json(await getAppeals(user));
    }
    throw new Error("Əməliyyat düzgün deyil.");
  } catch (error) { return failure(error, "Müraciət yenilənmədi."); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    await withdrawAppeal(user, Number(new URL(request.url).searchParams.get("id")));
    return Response.json(await getAppeals(user));
  } catch (error) { return failure(error, "Müraciət geri çağırılmadı."); }
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return Response.json({ error: message || fallback }, { status: 500 });
}
