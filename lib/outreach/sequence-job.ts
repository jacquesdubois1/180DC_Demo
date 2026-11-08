import "server-only";
import type { Tx } from "@/lib/db";
import { queueEmail, unsubscribeUrl } from "@/lib/email/outbox";
import { renderTemplate } from "@/lib/email/render";

interface DueEnrollment {
  id: string; lead_id: string; person_id: string; step_index: number; next_run_at: Date; created_at: Date;
  steps: { after_days: number; template_key: string }[]; sequence_active: boolean;
  stage: string; project_idea: string | null; sender_id: string | null; sender_name: string | null;
  email: string | null; first_name: string; person_dnc: boolean; organization: string; sector: string | null; org_dnc: boolean; replied: boolean;
}

/**
 * Automatic follow-ups ("no reply after 5 days -> follow-up 1, after 12 days -> follow-up 2").
 * `after_days` counts from the first e-mail. Runs inside one service-role transaction; rows are
 * locked with SKIP LOCKED so overlapping cron runs never double-send. Every step re-checks the
 * stop conditions, because a reply or an opt-out can arrive at any moment.
 */
export async function runSequences(tx: Tx, now = new Date()) {
  const due = await tx<DueEnrollment[]>`
    select e.id, e.lead_id, e.person_id, e.step_index, e.next_run_at, e.created_at, s.steps, s.is_active as sequence_active,
           l.stage::text as stage, l.project_idea, coalesce(l.owner_id, e.enrolled_by) as sender_id,
           (select display_name from app_users u where u.id = coalesce(l.owner_id, e.enrolled_by)) as sender_name,
           p.email::text as email, p.first_name, p.do_not_contact as person_dnc,
           o.name as organization, o.sector, o.do_not_contact as org_dnc,
           exists (select 1 from interactions i where i.lead_id = e.lead_id and i.type = 'email_in' and i.occurred_at > e.created_at) as replied
    from sequence_enrollments e
    join email_sequences s on s.id = e.sequence_id
    join leads l on l.id = e.lead_id
    join people p on p.id = e.person_id
    join organizations o on o.id = l.organization_id
    where e.status = 'active' and e.next_run_at <= ${now}
    order by e.next_run_at
    limit 200
    for update of e skip locked`;

  let sent = 0;
  let stopped = 0;
  let completed = 0;
  const stop = async (id: string, reason: string) => {
    await tx`update sequence_enrollments set status = 'stopped', stop_reason = ${reason} where id = ${id}`;
    stopped++;
  };

  for (const d of due) {
    const reason = d.replied ? "lead replied"
      : !["contacted", "follow_up"].includes(d.stage) ? `lead moved to ${d.stage.replace("_", " ")}`
      : d.person_dnc || d.org_dnc ? "do not contact"
      : !d.email ? "contact has no e-mail address"
      : !d.sequence_active ? "sequence paused"
      : null;
    if (reason) {
      await stop(d.id, reason);
      continue;
    }
    const step = d.steps[d.step_index];
    if (!step) {
      await tx`update sequence_enrollments set status = 'completed', stop_reason = 'all follow-ups sent' where id = ${d.id}`;
      completed++;
      continue;
    }
    const [tpl] = await tx<{ id: string; variant: string; subject: string; body: string }[]>`
      select id, variant, subject, body from email_templates
      where department = 'client_relations' and key = ${step.template_key} and is_active order by variant limit 1`;
    if (!tpl) {
      await stop(d.id, `template "${step.template_key}" is missing or inactive`);
      continue;
    }
    const email = d.email!;
    const vars = {
      first_name: d.first_name || "there",
      organization: d.organization,
      sector: (d.sector ?? "your field").toLowerCase(),
      project_idea: (d.project_idea ?? "a strategic question you are facing").replace(/^\w/, (c) => c.toLowerCase()),
      sender_name: d.sender_name ?? "The 180DC Barcelona team",
      unsubscribe_link: await unsubscribeUrl(email),
    };
    const q = await queueEmail(tx, {
      department: "client_relations", to: email, toPersonId: d.person_id,
      subject: renderTemplate(tpl.subject, vars).text, body: renderTemplate(tpl.body, vars).text,
      templateId: tpl.id, templateVariant: tpl.variant, leadId: d.lead_id, fromUserId: d.sender_id,
      campaign: "Automatic follow-up", scheduledFor: now,
    });
    if ("skipped" in q) {
      await stop(d.id, "recipient is on the suppression list");
      continue;
    }
    sent++;
    if (d.stage === "contacted") await tx`select app.move_lead(${d.lead_id}, 'follow_up', ${`Automatic follow-up ${d.step_index + 1}`})`;

    const next = d.steps[d.step_index + 1];
    if (next) {
      // keep the original rhythm, but never schedule into the past if the job was paused
      const gapDays = Math.max(1, next.after_days - step.after_days);
      const base = Math.max(now.getTime(), new Date(d.next_run_at).getTime());
      await tx`update sequence_enrollments set step_index = step_index + 1, next_run_at = ${new Date(base + gapDays * 864e5)} where id = ${d.id}`;
      await tx`update leads set next_step = ${`Automatic follow-up ${d.step_index + 2} in ${gapDays} days`}, next_step_due = current_date + ${gapDays}::int where id = ${d.lead_id}`;
    } else {
      await tx`update sequence_enrollments set step_index = step_index + 1, status = 'completed', stop_reason = 'all follow-ups sent' where id = ${d.id}`;
      await tx`update leads set next_step = 'No reply to e-mails - try a call or LinkedIn', next_step_due = current_date + 3 where id = ${d.lead_id}`;
      completed++;
    }
  }
  return { due: due.length, sent, stopped, completed };
}
