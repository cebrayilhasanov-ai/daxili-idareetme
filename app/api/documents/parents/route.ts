import { parentCandidates, type LinkKind } from "@/db/catalog";
import { requireUser } from "@/lib/auth";
import { requireSection } from "@/lib/permissions";

// Versiya 3.52: the documents a new (or edited) document may be linked to as its parent — for the registration forms of
// Çıxan, Daxil olan and Şirkətdaxili sənədlər. Only whoever may open that register asks; the rule itself is in db/catalog.ts.
const SECTIONS: Record<LinkKind, "documents.outgoing" | "documents.incoming" | "documents.internal"> = {
  outgoing: "documents.outgoing", incoming: "documents.incoming", internal: "documents.internal",
};

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") as LinkKind;
    if (!SECTIONS[kind]) return Response.json({ error: "Reyestr düzgün deyil." }, { status: 400 });
    const user = await requireSection(await requireUser(request), SECTIONS[kind]);
    return Response.json(await parentCandidates(user, kind, {
      companyId: Number(params.get("companyId")) || 0,
      documentType: String(params.get("type") || ""),
      voen: params.get("voen") || undefined,
      exclude: Number(params.get("exclude")) || undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    if (message === "FORBIDDEN") return Response.json({ error: "İcazə yoxdur." }, { status: 403 });
    return Response.json({ error: message || "Siyahı açıla bilmədi." }, { status: 500 });
  }
}
