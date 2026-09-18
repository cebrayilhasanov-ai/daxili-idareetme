import { env } from "@/lib/runtime";

export type SessionUser = { id: number; name: string; email: string; role: "admin" | "employee"; employeeId: number | null; backgroundKey: string | null; avatarKey: string | null };

function database() {
  if (!env.DB) throw new Error("Məlumat bazası aktiv deyil.");
  return env.DB;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password: string, salt: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, material, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

export async function ensureAuthSchema() {
  await database().prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY NOT NULL,
    fail_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  )`).run();
  await database().prepare(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    employee_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`).run();
  await database().prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  const userColumns = await database().prepare("PRAGMA table_info(app_users)").all<{ name: string }>();
  if (!userColumns.results.some((column) => column.name === "background_key")) {
    await database().prepare("ALTER TABLE app_users ADD COLUMN background_key TEXT").run();
  }
  if (!userColumns.results.some((column) => column.name === "avatar_key")) {
    await database().prepare("ALTER TABLE app_users ADD COLUMN avatar_key TEXT").run();
  }
  const admin = await database().prepare("SELECT id FROM app_users WHERE role = 'admin' LIMIT 1").first();
  const initialPassword = (env as unknown as Record<string, string>).ADMIN_INITIAL_PASSWORD;
  if (!admin && initialPassword) await createUser({ name: "Cəbrayıl Həsənov", email: "hesenovcabrayil@gmail.com", password: initialPassword, role: "admin" });
  else if (admin && initialPassword) await refreshInitialPassword(Number((admin as { id: number }).id), initialPassword);
  const aysunPassword = (env as unknown as Record<string, string>).AYSUN_INITIAL_PASSWORD;
  const aysunEmail = "accounting3@arsenalfire.az";
  const aysunAccount = await database().prepare("SELECT id FROM app_users WHERE email = ?").bind(aysunEmail).first();
  if (!aysunAccount && aysunPassword) {
    let employee = await database().prepare("SELECT id FROM employees WHERE lower(email) = ?").bind(aysunEmail).first<{ id: number }>();
    if (!employee) {
      await database().prepare("INSERT INTO employees (name,position,email,active,created_at) VALUES (?,?,?,?,?)")
        .bind("Aysun İsmayılova", "Personal", aysunEmail, 1, new Date().toISOString()).run();
      employee = await database().prepare("SELECT id FROM employees WHERE lower(email) = ?").bind(aysunEmail).first<{ id: number }>();
    }
    await createUser({ name: "Aysun İsmayılova", email: aysunEmail, password: aysunPassword, role: "employee", employeeId: employee?.id });
  }
  else if (aysunAccount && aysunPassword) await refreshInitialPassword(Number((aysunAccount as { id: number }).id), aysunPassword);
}

async function refreshInitialPassword(id: number, password: string) {
  const row = await database().prepare("SELECT must_change_password FROM app_users WHERE id = ?").bind(id).first<{ must_change_password: number }>();
  if (!row?.must_change_password) return;
  const salt = crypto.randomUUID();
  await database().prepare("UPDATE app_users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(await passwordHash(password, salt), salt, id).run();
}

export async function createUser(input: { name: string; email: string; password: string; role?: "admin" | "employee"; employeeId?: number | null }) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email || input.password.length < 8) throw new Error("Ad, e-poçt və ən az 8 simvolluq şifrə daxil edin.");
  const salt = crypto.randomUUID();
  const hash = await passwordHash(input.password, salt);
  await database().prepare(`INSERT INTO app_users
    (name,email,password_hash,password_salt,role,employee_id,active,must_change_password,created_at)
    VALUES (?,?,?,?,?,?,1,1,?)`)
    .bind(name, email, hash, salt, input.role || "employee", input.employeeId || null, new Date().toISOString()).run();
}

async function checkLoginLock(email: string) {
  const row = await database().prepare("SELECT locked_until FROM login_attempts WHERE email = ?").bind(email).first<{ locked_until: string | null }>();
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000));
    throw new Error(`Çox sayda uğursuz cəhd. ${minutesLeft} dəqiqədən sonra yenidən cəhd edin.`);
  }
}

async function registerLoginFailure(email: string) {
  const row = await database().prepare("SELECT fail_count FROM login_attempts WHERE email = ?").bind(email).first<{ fail_count: number }>();
  const failCount = (row?.fail_count || 0) + 1;
  const locked = failCount >= MAX_LOGIN_ATTEMPTS;
  const lockedUntil = locked ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000).toISOString() : null;
  await database().prepare(`INSERT INTO login_attempts (email, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
    .bind(email, locked ? 0 : failCount, lockedUntil, new Date().toISOString()).run();
}

async function clearLoginFailures(email: string) {
  await database().prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}

export async function login(emailInput: string, password: string) {
  await ensureAuthSchema();
  const email = emailInput.trim().toLowerCase();
  await checkLoginLock(email);
  const row = await database().prepare("SELECT * FROM app_users WHERE email = ? AND active = 1").bind(email).first<Record<string, unknown>>();
  if (!row || await passwordHash(password, String(row.password_salt)) !== row.password_hash) {
    await registerLoginFailure(email);
    throw new Error("E-poçt və ya şifrə yanlışdır.");
  }
  await clearLoginFailures(email);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await database().prepare("INSERT INTO app_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .bind(await digest(token), row.id, expires, new Date().toISOString()).run();
  return { token, user: toUser(row), mustChangePassword: Boolean(row.must_change_password) };
}

function toUser(row: Record<string, unknown>): SessionUser {
  return { id: Number(row.id), name: String(row.name), email: String(row.email), role: row.role === "admin" ? "admin" : "employee", employeeId: row.employee_id ? Number(row.employee_id) : null, backgroundKey: row.background_key ? String(row.background_key) : null, avatarKey: row.avatar_key ? String(row.avatar_key) : null };
}

export async function setUserBackground(userId: number, backgroundKey: string | null) {
  await database().prepare("UPDATE app_users SET background_key = ? WHERE id = ?").bind(backgroundKey, userId).run();
}

export async function setUserAvatar(userId: number, avatarKey: string | null) {
  await database().prepare("UPDATE app_users SET avatar_key = ? WHERE id = ?").bind(avatarKey, userId).run();
}

function cookieToken(request: Request) {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)di_session=([^;]+)/)?.[1] || "";
}

export async function currentUser(request: Request) {
  await ensureAuthSchema();
  const token = cookieToken(request);
  if (!token) return null;
  const row = await database().prepare(`SELECT app_users.* FROM app_sessions
    JOIN app_users ON app_users.id = app_sessions.user_id
    WHERE app_sessions.token_hash = ? AND app_sessions.expires_at > ? AND app_users.active = 1`)
    .bind(await digest(token), new Date().toISOString()).first<Record<string, unknown>>();
  return row ? { ...toUser(row), mustChangePassword: Boolean(row.must_change_password) } : null;
}

export async function requireUser(request: Request, role?: "admin") {
  const user = await currentUser(request);
  if (!user) throw new Error("AUTH_REQUIRED");
  if (role === "admin" && user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

export async function logout(request: Request) {
  const token = cookieToken(request);
  if (token) await database().prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await digest(token)).run();
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8) throw new Error("Yeni şifrə ən az 8 simvol olmalıdır.");
  const row = await database().prepare("SELECT * FROM app_users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
  if (!row || await passwordHash(currentPassword, String(row.password_salt)) !== row.password_hash) throw new Error("Cari şifrə yanlışdır.");
  const salt = crypto.randomUUID();
  await database().prepare("UPDATE app_users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?")
    .bind(await passwordHash(newPassword, salt), salt, userId).run();
}

export async function listUsers() {
  return (await database().prepare("SELECT id,name,email,role,employee_id,active,must_change_password,created_at FROM app_users ORDER BY role, name").all()).results;
}

export async function setUserActive(id: number, active: boolean) {
  const user = await database().prepare("SELECT employee_id FROM app_users WHERE id = ? AND role != 'admin'").bind(id).first<{ employee_id: number | null }>();
  await database().prepare("UPDATE app_users SET active = ? WHERE id = ? AND role != 'admin'").bind(Number(active), id).run();
  if (user?.employee_id) await database().prepare("UPDATE employees SET active = ? WHERE id = ?").bind(Number(active), user.employee_id).run();
  if (!active) await database().prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(id).run();
}

export async function resetUserPassword(id: number, password: string) {
  if (password.length < 8) throw new Error("Yeni şifrə ən az 8 simvol olmalıdır.");
  const salt = crypto.randomUUID();
  await database().prepare("UPDATE app_users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ? AND role != 'admin'")
    .bind(await passwordHash(password, salt), salt, id).run();
  await database().prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(id).run();
}
