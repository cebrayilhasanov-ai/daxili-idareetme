import { env } from "@/lib/runtime";
import { requireUser } from "@/lib/auth";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|wsh|jar|apk|dll|sh|bin|app|cpl|reg|hta|lnk)$/i;

export async function POST(request: Request) {
  try {
    await requireUser(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Fayl seçilməyib." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Faylın həcmi 25 MB-dan çox ola bilməz." }, { status: 413 });
    if (BLOCKED_EXTENSIONS.test(file.name)) return Response.json({ error: "Bu fayl növünə icazə verilmir." }, { status: 400 });
    const key = `${crypto.randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_")}`;
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name } });
    return Response.json({ key, name: file.name, size: file.size, type: file.type || "application/octet-stream" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Fayl yüklənmədi." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try { await requireUser(request); } catch { return new Response("Giriş tələb olunur.", { status: 401 }); }
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Fayl seçilməyib.", { status: 400 });
  const object = await env.FILES.get(key);
  if (!object) return new Response("Fayl tapılmadı.", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const isImage = (object.httpMetadata?.contentType || "").startsWith("image/");
  headers.set("content-disposition", `${isImage ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.originalName || "fayl")}`);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
