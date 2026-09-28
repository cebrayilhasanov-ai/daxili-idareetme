import { readOutgoingFile, saveOutgoingFile } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

function stageOf(value: unknown) {
  if (value === "draft" || value === "final") return value;
  throw new Error("Sənədin mərhələsi düzgün deyil.");
}

// Upload of the written (draft) or client-signed (final) document: whatever name it arrives with, it is renamed by the template's rule
// and written into the template's folder on the server.
export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.outgoing");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Fayl seçilməyib." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Faylın həcmi 25 MB-dan çox ola bilməz." }, { status: 413 });
    const id = Number(form.get("id"));
    const kind = stageOf(form.get("kind"));
    const saved = await saveOutgoingFile(user, { id, kind, fileName: file.name, contentType: file.type, data: new Uint8Array(await file.arrayBuffer()) });
    await logAudit(user, kind === "draft" ? "Çıxan sənədin ilkin faylı yükləndi" : "Çıxan sənədin imzalı faylı yükləndi", "outgoing-document", `#${id} ${saved.name}`);
    return Response.json(saved);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Fayl yüklənmədi." }, { status: 400 }); }
}

export async function GET(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.outgoing");
    const params = new URL(request.url).searchParams;
    const file = await readOutgoingFile(user, Number(params.get("id")), stageOf(params.get("kind")));
    if (!file) return new Response("Fayl papkada tapılmadı. Ola bilsin, adı dəyişdirilib və ya başqa yerə köçürülüb.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const isPreviewable = /^(image\/|application\/pdf)/.test(file.type);
    return new Response(Uint8Array.from(file.data), { headers: {
      "content-type": file.type,
      "content-length": String(file.data.byteLength),
      "content-disposition": `${isPreviewable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    } });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    return new Response(error instanceof Error ? error.message : "Fayl açıla bilmədi.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
