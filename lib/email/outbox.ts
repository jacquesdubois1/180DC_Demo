import "server-only";
import { type Tx, withService } from "@/lib/db";
import { env } from "@/lib/env";
import { signLinkToken } from "@/lib/auth/session";

/**
 * Outbox pattern. queueEmail() only writes a row (inside the caller's transaction, so
 * RLS decides whether this user may send for this department). processOutbox() picks
 * due rows, respects per-sender daily limits, sends through the configured provider and
 * logs the result - and, for outreach, writes the interaction on the lead.
 */

export interface QueueInput {
  department: "hr" | "client_relations";
  to: string;
  toPersonId?: string | null;
  subject: string;
  body: string;
  templateId?: string | null;
  templateVariant?: string | null;
  applicationId?: string | null;
  leadId?: string | null;
  fromUserId?: string | null;
  campaign?: string | null;
  status?: "queued" | "needs_review" | "draft";
  scheduledFor?: Date;
}

export async function queueEmail(tx: Tx, e: QueueInput): Promise<{ id: string } | { skipped: string }> {
  const [{ suppressed }] = await tx<{ suppressed: boolean }[]>`select app.is_suppressed(${e.to}) as suppressed`;
  if (suppressed) return { skipped: "Recipient opted out or is on the suppression list" };
  const [row] = await tx<{ id: string }[]>`
    insert into email_outbox (department, to_email, to_person_id, subject, body_text, template_id, template_variant,
      application_id, lead_id, from_user_id, campaign, status, scheduled_for)
    values (${e.department}, ${e.to}, ${e.toPersonId ?? null}, ${e.subject}, ${e.body}, ${e.templateId ?? null},
      ${e.templateVariant ?? null}, ${e.applicationId ?? null}, ${e.leadId ?? null}, ${e.fromUserId ?? null},
      ${e.campaign ?? null}, ${e.status ?? "queued"}, ${e.scheduledFor ?? new Date()})
    returning id`;
  return { id: row.id };
}

/** Link for the e-mail body: opens a confirmation page (link scanners cannot unsubscribe anyone by prefetching). */
export async function unsubscribeUrl(email: string) {
  const token = await signLinkToken({ email: email.toLowerCase(), purpose: "unsubscribe" });
  return `${env().APP_URL}/unsubscribe/${token}`;
}

/** RFC 8058 one-click endpoint for the List-Unsubscribe header (mail clients POST to it). */
export async function oneClickUnsubscribeUrl(email: string) {
  const token = await signLinkToken({ email: email.toLowerCase(), purpose: "unsubscribe" });
  return `${env().APP_URL}/api/unsubscribe/${token}`;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
interface OutgoingMail {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  listUnsubscribe?: string;
}

async function sendViaProvider(mail: OutgoingMail): Promise<{ provider: string; id: string }> {
  const e = env();
  if (e.EMAIL_PROVIDER === "resend") {
    if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text,
        reply_to: mail.replyTo ?? undefined,
        headers: mail.listUnsubscribe ? { "List-Unsubscribe": `<${mail.listUnsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { id: string };
    return { provider: "resend", id: body.id };
  }
  // "log": development / demo - nothing leaves the server
  console.info(`[email:log] to=${mail.to} subject="${mail.subject}"`);
  return { provider: "log", id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number; deferred: number }> {
  const e = env();
  const settings = await withService((sql) => sql<{ value: { daily_limit_per_sender?: number } }[]>`
    select value from settings where key = 'email'`);
  const dailyLimit = settings[0]?.value?.daily_limit_per_sender ?? 80;

  // claim due rows atomically so two workers never send the same e-mail
  const claimed = await withService((sql) => sql<{
    id: string; to_email: string; subject: string; body_text: string; from_user_id: string | null; department: string;
    lead_id: string | null; to_person_id: string | null; template_id: string | null; template_variant: string | null;
    sender_name: string | null; sender_email: string | null; sent_today: number;
  }[]>`
    with due as (
      select o.id from email_outbox o
      where o.status = 'queued' and o.scheduled_for <= now()
      order by o.scheduled_for limit ${limit}
      for update skip locked)
    update email_outbox o set status = 'sending', attempts = o.attempts + 1
    from due where o.id = due.id
    returning o.id, o.to_email::text, o.subject, o.body_text, o.from_user_id, o.department::text, o.lead_id, o.to_person_id,
      o.template_id, o.template_variant,
      (select display_name from app_users u where u.id = o.from_user_id) as sender_name,
      (select email::text from app_users u where u.id = o.from_user_id) as sender_email,
      (select count(*)::int from email_outbox x where x.from_user_id = o.from_user_id and x.status = 'sent'
         and x.sent_at > date_trunc('day', now())) as sent_today`);

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const sentPerSender = new Map<string, number>();
  for (const m of claimed) {
    const key = m.from_user_id ?? "system";
    const already = m.sent_today + (sentPerSender.get(key) ?? 0);
    if (m.from_user_id && already >= dailyLimit) {
      await withService((sql) => sql`update email_outbox set status = 'queued', attempts = attempts - 1,
        scheduled_for = date_trunc('day', now()) + interval '1 day 8 hours' where id = ${m.id}`);
      deferred++;
      continue;
    }
    try {
      const listUnsubscribe = m.department === "client_relations" ? await oneClickUnsubscribeUrl(m.to_email) : undefined;
      const from = m.sender_name ? `${m.sender_name} via 180DC Hub <${e.EMAIL_FROM.match(/<(.+)>/)?.[1] ?? e.EMAIL_FROM}>` : e.EMAIL_FROM;
      const res = await sendViaProvider({ to: m.to_email, from, replyTo: m.sender_email, subject: m.subject, text: m.body_text, listUnsubscribe });
      await withService(async (sql) => {
        await sql`update email_outbox set status = 'sent', sent_at = now(), provider = ${res.provider},
                  provider_message_id = ${res.id}, last_error = null where id = ${m.id}`;
        if (m.lead_id) {
          await sql`insert into interactions (organization_id, lead_id, person_id, type, subject, summary, email_outbox_id,
                      template_id, template_variant, created_by)
                    select l.organization_id, l.id, ${m.to_person_id}, 'email_out', ${m.subject}, 'Sent via Hub', ${m.id},
                      ${m.template_id}, ${m.template_variant}, ${m.from_user_id}
                    from leads l where l.id = ${m.lead_id}`;
        }
      });
      sentPerSender.set(key, (sentPerSender.get(key) ?? 0) + 1);
      sent++;
    } catch (err) {
      failed++;
      await withService((sql) => sql`update email_outbox set
          status = case when attempts >= 3 then 'failed'::email_status else 'queued'::email_status end,
          scheduled_for = now() + make_interval(mins => 5 * attempts), last_error = ${String((err as Error).message).slice(0, 500)}
        where id = ${m.id}`);
    }
  }
  return { sent, failed, deferred };
}
