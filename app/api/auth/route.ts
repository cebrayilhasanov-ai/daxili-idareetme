import { changePassword, currentUser, login, logout, setUserBackground } from "@/lib/auth";

const cookie = (request: Request, token: string, maxAge: number) => {
  const isHttps = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `di_session=${token}; Path=/; HttpOnly; ${isHttps ? "Secure; " : ""}SameSite=Lax; Max-Age=${maxAge}`;
};

export async function GET(request: Request) {
  const user = await currentUser(request);
  return user ? Response.json({ user }) : Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "login") {
      const result = await login(body.email || "", body.password || "");
      return Response.json({ user: { ...result.user, mustChangePassword: result.mustChangePassword } }, { headers: { "set-cookie": cookie(request, result.token, 604800) } });
    }
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "Giriş tələb olunur." }, { status: 401 });
    if (body.action === "change-password") {
      await changePassword(user.id, body.currentPassword || "", body.newPassword || "");
      return Response.json({ ok: true });
    }
    if (body.action === "logout") {
      await logout(request);
      return Response.json({ ok: true }, { headers: { "set-cookie": cookie(request, "", 0) } });
    }
    if (body.action === "set-background") {
      await setUserBackground(user.id, body.backgroundKey || null);
      return Response.json({ user: { ...user, backgroundKey: body.backgroundKey || null } });
    }
    return Response.json({ error: "Əməliyyat seçilməyib." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Əməliyyat baş tutmadı." }, { status: 400 });
  }
}
