// Scheduled (cron) job: emails an employee once when one of their tasks
// becomes overdue. Only ever invoked from worker/index.ts's `scheduled`
// handler, so it takes the D1 binding directly instead of importing the
// `cloudflare:workers` `env` (that binding relies on request-scoped
// AsyncLocalStorage that scheduled events don't go through).
export async function sendOverdueEmails(db: D1Database, resendApiKey: string | undefined) {
  if (!resendApiKey) return;
  const columns = await db.prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "overdue_notified_at")) {
    await db.prepare("ALTER TABLE tasks ADD COLUMN overdue_notified_at TEXT").run();
  }
  const rows = await db.prepare(`SELECT tasks.id, tasks.title, tasks.due_at, employees.name AS employee_name, employees.email AS employee_email
    FROM tasks JOIN employees ON employees.id = tasks.employee_id
    WHERE tasks.status IN ('Yeni','İcradadır','Geri qaytarılıb')
      AND tasks.due_at < ?
      AND tasks.overdue_notified_at IS NULL
      AND employees.email IS NOT NULL AND employees.email != ''`)
    .bind(new Date().toISOString())
    .all<{ id: number; title: string; due_at: string; employee_name: string; employee_email: string }>();

  for (const task of rows.results) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({
          from: "Daxili İdarəetmə <onboarding@resend.dev>",
          to: task.employee_email,
          subject: `Gecikmiş tapşırıq: ${task.title}`,
          html: `<p>Salam ${task.employee_name},</p><p><b>${task.title}</b> adlı tapşırığınızın son icra tarixi keçib.</p><p>Zəhmət olmasa sistemə daxil olub statusunu yeniləyin.</p>`,
        }),
      });
      if (!response.ok) continue;
    } catch {
      continue;
    }
    await db.prepare("UPDATE tasks SET overdue_notified_at = ? WHERE id = ?").bind(new Date().toISOString(), task.id).run();
  }
}
