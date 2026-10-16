import { addRequestType, listRequestTypes, removeRequestType, renameRequestType } from "@/db/requests";
import { requireUser } from "@/lib/auth";

// Versiya 3.36: "Sorğu növləri". Every signed-in user reads the list (Sorğular, a step's "Şöbəyə sorğu", an incoming document's
// "Sorğu yarat"); only the admin adds, renames or removes a type.
function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return Response.json({ types: await listRequestTypes() });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Sorğu növləri açıla bilmədi." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await requireUser(request, "admin");
    const body = await request.json();
    return Response.json({ types: await addRequestType(body.name) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Növ əlavə edilmədi." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    await requireUser(request, "admin");
    const body = await request.json();
    return Response.json({ types: await renameRequestType(Number(body.id), body.name) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Növ dəyişdirilmədi." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    await requireUser(request, "admin");
    const id = Number(new URL(request.url).searchParams.get("id"));
    return Response.json({ types: await removeRequestType(id) });
  } catch (error) { return authError(error) || Response.json({ error: error instanceof Error ? error.message : "Növ silinmədi." }, { status: 400 }); }
}
