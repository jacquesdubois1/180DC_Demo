import "server-only";
import { verifyLinkToken } from "@/lib/auth/session";
import { withService } from "@/lib/db";

/** Decode an unsubscribe token; null if forged, expired or for another purpose. */
export async function readUnsubscribeToken(token: string): Promise<string | null> {
  if (!token || token.length > 2000) return null;
  const p = await verifyLinkToken<{ email?: string; purpose?: string }>(token);
  return p?.purpose === "unsubscribe" && typeof p.email === "string" ? p.email : null;
}

/**
 * Honour an opt-out everywhere at once: suppression list (checked before every send),
 * do-not-contact on the person, queued e-mails cancelled, follow-up sequences stopped,
 * and a note on the lead so the team sees why the contact went quiet.
 */
export async function unsubscribeEmail(email: string, source: "link" | "one_click") {
  return withService(async (sql) => {
    await sql`insert into email_suppressions (email, reason, source) values (${email}, 'unsubscribe', ${source})
              on conflict (email) where email is not null do nothing`;
    const people = await sql<{ id: string }[]>`
      update people set do_not_contact = true, do_not_contact_at = coalesce(do_not_contact_at, now())
      where email = ${email} returning id`;
    const ids = people.map((p) => p.id);
    const cancelled = await sql`update email_outbox set status = 'cancelled', last_error = 'recipient unsubscribed'
      where to_email = ${email} and department = 'client_relations' and status in ('queued', 'draft', 'needs_review') returning id`;
    if (ids.length) {
      await sql`update sequence_enrollments set status = 'stopped', stop_reason = 'unsubscribed' where person_id = any(${ids}) and status = 'active'`;
      await sql`insert into interactions (organization_id, lead_id, person_id, type, subject, summary)
        select distinct on (l.id) l.organization_id, l.id, lc.person_id, 'note', 'Opted out', 'The contact used the unsubscribe link. Do not e-mail again.'
        from lead_contacts lc join leads l on l.id = lc.lead_id
        where lc.person_id = any(${ids}) and l.stage not in ('won', 'lost', 'not_interested')`;
    }
    await sql`select app.log_event('email.unsubscribed', 'person', ${ids[0] ?? null}::uuid, ${sql.json({ source, people: ids.length, cancelled: cancelled.length })})`;
    return { people: ids.length, cancelled: cancelled.length };
  });
}

/** "ana.lopez@example.com" -> "a••••••z@example.com" for display on the public page. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "your address";
  return `${local[0]}${"•".repeat(Math.max(2, Math.min(8, local.length - 2)))}${local.length > 1 ? local.at(-1) : ""}@${domain}`;
}
