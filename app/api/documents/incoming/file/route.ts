import { readIncomingFile, saveIncomingFile } from "@/db/catalog";
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

// The scan of an incoming document: renamed by the Daxil olan naming rule and written into its folder on the server.
export async function POST(request: Request) {
  try {
    const user = await requireSection(await requireUser(request), "documents.incoming");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Fayl seçilməyib." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Faylın həcmi 25 MB-dan çox ola bilməz." }, { status: 413 });
    const id = Number(form.get("id"));
    const saved = await saveIncomingFile(user, { id, fileName: file.name, contentType: file.type, data: new Uint8Array(await file.arrayBuffer()) });
    await logAudit(user, "Daxil olan sənədin faylı yükləndi", "incoming-document", `#${id} ${saved.name}`);
    return Response.json(saved);
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Fayl yüklənmədi." }, { status: 400 }); }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const sectionAllowed = await requireSection(user, "documents.incoming").then(() => true, () => false);
    const file = await readIncomingFile(user, Number(new URL(request.url).searchParams.get("id")), sectionAllowed);
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
