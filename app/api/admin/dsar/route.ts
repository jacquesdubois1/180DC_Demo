import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { withUser } from "@/lib/db";

/**
 * Right of access (GDPR Art. 15): everything the Hub stores about one person, as JSON.
 * Other people's identities are left out (reviewers appear as "reviewer 1, 2…"), file
 * contents are listed, not embedded. The export itself is written to the audit log.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!hasRole(user, "admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const data = await withUser(user!.id, async (sql) => {
    const [person] = await sql<{ id: string; row: Record<string, unknown> }[]>`
      select id, to_jsonb(p) - 'search_text' as row from people p where p.email = ${email}`;
    const suppressions = await sql`select reason, source, created_at from email_suppressions where email = ${email}`;
    if (!person) return suppressions.length ? { person: null, suppressions } : null;
    const pid = person.id;
    const apps = await sql<{ id: string }[]>`select id from applications where person_id = ${pid}`;
    const appIds = apps.map((a) => a.id);
    const reviewers = new Map<string, string>();
    const alias = (id: string) => {
      if (!reviewers.has(id)) reviewers.set(id, `reviewer ${reviewers.size + 1}`);
      return reviewers.get(id)!;
    };
    const reviews = (await sql<{ reviewer_id: string; stage: string; scores: unknown; recommendation: string | null; comment: string | null; submitted_at: string | null }[]>`
      select reviewer_id, stage::text, scores, recommendation::text, comment, submitted_at from reviews where application_id = any(${appIds}) and submitted_at is not null`)
      .map(({ reviewer_id, ...r }) => ({ reviewer: alias(reviewer_id), ...r }));
    const account = await sql`select u.email, u.display_name, u.department, u.title, u.created_at, u.last_login_at,
        coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
      from app_users u left join user_roles r on r.user_id = u.id where u.person_id = ${pid} group by u.id`;
    const result = {
      export: { generated_at: new Date().toISOString(), subject: email, controller: "180 Degrees Consulting Barcelona" },
      person: person.row,
      roles: await sql`select role, title, department, start_date, end_date, is_esade_alumni,
          (select name from organizations o where o.id = pr.organization_id) as organization from person_roles pr where person_id = ${pid}`,
      applications: await sql`select to_jsonb(a) - 'person_id' as application,
          (select name from recruitment_cycles c where c.id = a.cycle_id) as cycle,
          (select name from positions p where p.id = a.position_id) as position
        from applications a where a.person_id = ${pid}`,
      application_history: await sql`select entity_id as application_id, from_status, to_status, note, changed_at from status_history
        where entity = 'application' and entity_id = any(${appIds}) order by changed_at`,
      reviews,
      interviews: await sql`select round, scheduled_at, duration_minutes, format, status from interviews where application_id = any(${appIds})`,
      comments: await sql`select body, created_at from application_comments where application_id = any(${appIds})`,
      files: await sql`select f.filename, f.content_type, f.size_bytes, f.created_at from files f join applications a on a.cv_file_id = f.id where a.person_id = ${pid}`,
      emails_received: await sql`select subject, body_text, status, sent_at from email_outbox where to_person_id = ${pid} or to_email = ${email} order by created_at`,
      outreach_interactions: await sql`select type, occurred_at, subject, summary from interactions where person_id = ${pid} order by occurred_at`,
      account: account[0] ?? null,
      suppressions,
    };
    await sql`select app.log_event('gdpr.access_export', 'person', ${pid}, ${sql.json({ by: user!.id })})`;
    return result;
  });
  if (!data) return NextResponse.json({ error: "No data stored for this e-mail address" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="data-export-${email.replace(/[^a-z0-9@._-]/g, "_")}.json"`,
      "cache-control": "no-store",
    },
  });
}
