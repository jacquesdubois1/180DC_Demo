"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { dbErrorMessage, type Tx, withUser } from "@/lib/db";
import { processOutbox, queueEmail, unsubscribeUrl } from "@/lib/email/outbox";
import { renderTemplate } from "@/lib/email/render";
import type { ActionResult } from "@/lib/hr/actions";
import { thompsonAllocate } from "./abtest";
import { recomputeScores } from "./score-job";
import { LEAD_STAGES, type LeadStage } from "./stages";

const uuid = z.string().uuid();
const revalidate = () => revalidatePath("/outreach", "layout");

export async function moveLead(leadId: string, to: LeadStage, note?: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  if (!uuid.safeParse(leadId).success || !LEAD_STAGES.includes(to)) return { ok: false, error: "Invalid request" };
  try {
    await withUser(user.id, (tx) => tx`select app.move_lead(${leadId}, ${to}::lead_stage, ${note?.trim() || null})`);
    revalidate();
    return { ok: true, message: `Moved to ${to.replace("_", " ")}` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const leadPatch = z.object({
  ownerId: uuid.nullable().optional(),
  nextStep: z.string().max(300).nullable().optional(),
  nextStepDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.number().int().min(1).max(3).optional(),
  projectIdea: z.string().max(500).nullable().optional(),
});

export async function updateLead(leadId: string, patch: z.infer<typeof leadPatch>): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = leadPatch.safeParse(patch);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const v = p.data;
  try {
    await withUser(user.id, (tx) => tx`update leads set
      owner_id = case when ${v.ownerId === undefined} then owner_id else ${v.ownerId ?? null}::uuid end,
      next_step = case when ${v.nextStep === undefined} then next_step else ${v.nextStep ?? null} end,
      next_step_due = case when ${v.nextStepDue === undefined} then next_step_due else ${v.nextStepDue ?? null}::date end,
      priority = coalesce(${v.priority ?? null}::int, priority),
      project_idea = case when ${v.projectIdea === undefined} then project_idea else ${v.projectIdea ?? null} end
      where id = ${leadId}`);
    revalidate();
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const interactionSchema = z.object({
  leadId: uuid,
  type: z.enum(["call", "meeting", "note", "email_in", "email_out", "linkedin"]),
  summary: z.string().min(2).max(4000),
  personId: uuid.nullable().optional(),
  occurredAt: z.string().optional(),
  nextStep: z.string().max(300).optional(),
  nextStepDue: z.string().optional(),
});

/** Log a call, meeting, note or an e-mail received outside the Hub (and optionally the next step). */
export async function logInteraction(input: z.infer<typeof interactionSchema>): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = interactionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Please add a short summary" };
  const v = p.data;
  try {
    await withUser(user.id, async (tx) => {
      const [lead] = await tx<{ organization_id: string; stage: string }[]>`select organization_id, stage::text from leads where id = ${v.leadId}`;
      await tx`insert into interactions (organization_id, lead_id, person_id, type, occurred_at, summary)
        values (${lead.organization_id}, ${v.leadId}, ${v.personId ?? null}, ${v.type}, ${v.occurredAt ? new Date(v.occurredAt) : new Date()}, ${v.summary})`;
      // an incoming reply moves early-stage leads forward and stops automatic follow-ups
      if (v.type === "email_in" && ["new", "contacted", "follow_up"].includes(lead.stage)) {
        await tx`select app.move_lead(${v.leadId}, 'replied', 'Reply logged')`;
      }
      if (v.nextStep || v.nextStepDue) {
        await tx`update leads set next_step = coalesce(${v.nextStep || null}, next_step),
                 next_step_due = coalesce(${v.nextStepDue || null}::date, next_step_due) where id = ${v.leadId}`;
      }
    });
    revalidate();
    return { ok: true, message: "Logged" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const contactSchema = z.object({
  organizationId: uuid,
  leadId: uuid.optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).default(""),
  email: z.string().email().optional().or(z.literal("")),
  title: z.string().max(120).optional(),
  linkedinUrl: z.string().max(300).optional(),
  isAlumni: z.boolean().default(false),
  primary: z.boolean().default(false),
});

export async function addContact(input: z.infer<typeof contactSchema>): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = contactSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Name and a valid e-mail are required" };
  const v = p.data;
  try {
    await withUser(user.id, async (tx) => {
      const [person] = await tx<{ id: string }[]>`
        insert into people (first_name, last_name, email, linkedin_url)
        values (${v.firstName}, ${v.lastName}, ${v.email || null}, ${v.linkedinUrl || null})
        on conflict (email) do update set linkedin_url = coalesce(people.linkedin_url, excluded.linkedin_url)
        returning id`;
      await tx`insert into person_roles (person_id, role, organization_id, title, is_esade_alumni)
        values (${person.id}, 'contact', ${v.organizationId}, ${v.title || null}, ${v.isAlumni}) on conflict do nothing`;
      if (v.leadId) {
        if (v.primary) await tx`update lead_contacts set is_primary = false where lead_id = ${v.leadId}`;
        await tx`insert into lead_contacts (lead_id, person_id, is_primary) values (${v.leadId}, ${person.id}, ${v.primary})
          on conflict (lead_id, person_id) do update set is_primary = excluded.is_primary`;
      }
    });
    revalidate();
    return { ok: true, message: "Contact added" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

/** Opt-out: nobody at this person / organisation is e-mailed again. */
export async function setDoNotContact(target: { personId?: string; organizationId?: string }, reason: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  try {
    await withUser(user.id, async (tx) => {
      if (target.personId) {
        const [p] = await tx<{ email: string | null }[]>`update people set do_not_contact = true, do_not_contact_at = now()
          where id = ${target.personId} returning email::text`;
        if (p?.email) await tx`insert into email_suppressions (email, reason, source) values (${p.email}, 'manual', ${reason}) on conflict do nothing`;
        await tx`update sequence_enrollments set status = 'stopped', stop_reason = 'do not contact' where person_id = ${target.personId} and status = 'active'`;
        await tx`update email_outbox set status = 'cancelled' where to_person_id = ${target.personId} and status in ('queued', 'draft', 'needs_review')`;
      }
      if (target.organizationId) {
        const [o] = await tx<{ domain: string | null }[]>`update organizations set do_not_contact = true where id = ${target.organizationId} returning domain::text`;
        if (o?.domain) await tx`insert into email_suppressions (domain, reason, source) values (${o.domain}, 'manual', ${reason}) on conflict do nothing`;
      }
      await tx`select app.log_event('outreach.do_not_contact', 'person', ${target.personId ?? null}::uuid, ${tx.json({ organization: target.organizationId ?? null, reason })})`;
    });
    revalidate();
    return { ok: true, message: "Marked as do-not-contact; queued e-mails cancelled" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function recomputeLeadScores(): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  try {
    const r = await withUser(user.id, (tx) => recomputeScores(tx));
    revalidate();
    return { ok: true, message: `${r.scored} leads re-scored` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const orgSchema = z.object({
  name: z.string().min(2).max(160),
  website: z.string().max(300).optional(),
  type: z.enum(["company", "startup", "social_enterprise", "ngo", "foundation", "public_sector", "university", "other"]),
  sector: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  sizeBand: z.enum(["1-10", "11-50", "51-200", "201-1000", "1000+"]).optional(),
  createLead: z.boolean().default(true),
});

export async function createOrganization(input: z.infer<typeof orgSchema>): Promise<ActionResult<{ leadId?: string; duplicateOf?: string }>> {
  const user = await requireRole("client_relations");
  const p = orgSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Name and type are required" };
  const v = p.data;
  try {
    const res = await withUser(user.id, async (tx) => {
      const dup = await tx<{ id: string; name: string }[]>`
        select id, name from organizations
        where (domain is not null and domain = app.extract_domain(${v.website ?? null}))
           or extensions.similarity(normalized_name, app.normalize_org_name(${v.name})) > 0.6
        order by extensions.similarity(normalized_name, app.normalize_org_name(${v.name})) desc limit 1`;
      if (dup[0]) return { duplicateOf: dup[0].id, name: dup[0].name };
      const [o] = await tx<{ id: string }[]>`insert into organizations (name, website, type, sector, city, size_band, source)
        values (${v.name}, ${v.website || null}, ${v.type}, ${v.sector || null}, ${v.city || null}, ${v.sizeBand ?? null}, 'manual') returning id`;
      let leadId: string | undefined;
      if (v.createLead) {
        const [l] = await tx<{ id: string }[]>`insert into leads (organization_id, owner_id, source, next_step, next_step_due)
          values (${o.id}, ${user.id}, 'manual', 'Find decision maker', current_date + 3) returning id`;
        leadId = l.id;
      }
      return { leadId };
    });
    if ("duplicateOf" in res && res.duplicateOf) return { ok: false, error: `Looks like a duplicate of “${res.name}”. Open the existing organisation instead.` };
    revalidate();
    return { ok: true, message: "Organisation created", data: { leadId: res.leadId } };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Campaigns: personalised first-touch e-mails in bulk, A/B tested, throttled
// ---------------------------------------------------------------------------
const campaignSchema = z.object({
  leadIds: z.array(uuid).min(1).max(200),
  templateKey: z.string().min(1),
  mode: z.enum(["thompson", "split", "A", "B"]),
  perHour: z.number().int().min(5).max(200),
  enrollSequence: z.boolean(),
  campaign: z.string().max(80).optional(),
});

async function renderForLead(tx: Tx, leadId: string, tpl: { subject: string; body: string }, senderName: string) {
  const [l] = await tx<{ organization_name: string; sector: string | null; project_idea: string | null; primary_contact_id: string | null;
    primary_contact_name: string | null; primary_contact_email: string | null }[]>`
    select organization_name, sector, project_idea, primary_contact_id, primary_contact_name, primary_contact_email::text from v_leads where id = ${leadId}`;
  if (!l?.primary_contact_email) return null;
  const vars = {
    first_name: (l.primary_contact_name ?? "").split(" ")[0] || "there",
    organization: l.organization_name,
    sector: (l.sector ?? "your field").toLowerCase(),
    project_idea: (l.project_idea ?? "a strategic question you are facing").replace(/^\w/, (c) => c.toLowerCase()),
    sender_name: senderName,
    unsubscribe_link: await unsubscribeUrl(l.primary_contact_email),
  };
  return { to: l.primary_contact_email, personId: l.primary_contact_id, subject: renderTemplate(tpl.subject, vars).text, body: renderTemplate(tpl.body, vars).text };
}

export async function previewCampaign(leadIds: string[], templateKey: string): Promise<ActionResult<{ variant: string; to: string; subject: string; body: string }[]>> {
  const user = await requireRole("client_relations");
  const data = await withUser(user.id, async (tx) => {
    const tpls = await tx<{ variant: string; subject: string; body: string }[]>`
      select variant, subject, body from email_templates where department = 'client_relations' and key = ${templateKey} and is_active order by variant`;
    const out: { variant: string; to: string; subject: string; body: string }[] = [];
    for (const id of leadIds.slice(0, 3)) {
      const t: { variant: string; subject: string; body: string } | undefined = tpls[out.length % Math.max(tpls.length, 1)];
      if (!t) break;
      const r = await renderForLead(tx, id, t, user.name);
      if (r) out.push({ variant: t.variant, to: r.to, subject: r.subject, body: r.body });
    }
    return out;
  });
  return { ok: true, data };
}

export async function sendCampaign(input: z.infer<typeof campaignSchema>): Promise<ActionResult<{ queued: number; skipped: number }>> {
  const user = await requireRole("client_relations");
  const p = campaignSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Select at least one lead and a template" };
  const v = p.data;
  try {
    const res = await withUser(user.id, async (tx) => {
      const tpls = await tx<{ id: string; variant: string; subject: string; body: string }[]>`
        select id, variant, subject, body from email_templates where department = 'client_relations' and key = ${v.templateKey} and is_active order by variant`;
      if (!tpls.length) throw Object.assign(new Error("Template not found"), { code: "22023" });
      const perf = await tx<{ variant: string; sent: number; replied: number }[]>`
        select variant, sent, replied from v_template_performance where key = ${v.templateKey}`;
      const stats = tpls.map((t) => ({ variant: t.variant, sent: perf.find((x) => x.variant === t.variant)?.sent ?? 0, replied: perf.find((x) => x.variant === t.variant)?.replied ?? 0 }));
      const plan = v.mode === "thompson" ? thompsonAllocate(stats, v.leadIds.length)
        : v.mode === "split" ? v.leadIds.map((_, i) => tpls[i % tpls.length].variant)
        : v.leadIds.map(() => v.mode);
      const [seq] = await tx<{ id: string; steps: { after_days: number }[] }[]>`select id, steps from email_sequences where is_active and department = 'client_relations' limit 1`;
      let queued = 0;
      let skipped = 0;
      for (const [i, leadId] of v.leadIds.entries()) {
        const tpl = tpls.find((t) => t.variant === plan[i]) ?? tpls[0];
        const r = await renderForLead(tx, leadId, tpl, user.name);
        if (!r) { skipped++; continue; }
        // throttle: spread sends over time to protect the sender's reputation
        const when = new Date(Date.now() + Math.floor((i / v.perHour) * 3600_000));
        const q = await queueEmail(tx, { department: "client_relations", to: r.to, toPersonId: r.personId, subject: r.subject, body: r.body,
          templateId: tpl.id, templateVariant: tpl.variant, leadId, fromUserId: user.id, campaign: v.campaign ?? null, scheduledFor: when });
        if ("skipped" in q) { skipped++; continue; }
        queued++;
        const [cur] = await tx<{ stage: string }[]>`select stage::text from leads where id = ${leadId}`;
        if (cur?.stage === "new") await tx`select app.move_lead(${leadId}, 'contacted', 'First-touch e-mail queued')`;
        await tx`update leads set next_step = 'Follow up if no reply', next_step_due = current_date + 5 where id = ${leadId}`;
        if (v.enrollSequence && seq && r.personId) {
          await tx`insert into sequence_enrollments (sequence_id, lead_id, person_id, next_run_at, enrolled_by)
            values (${seq.id}, ${leadId}, ${r.personId}, ${new Date(when.getTime() + (seq.steps[0]?.after_days ?? 5) * 864e5)}, ${user.id})
            on conflict do nothing`;
        }
      }
      await tx`select app.log_event('outreach.campaign_queued', 'campaign', null, ${tx.json({ queued, skipped, mode: v.mode, template: v.templateKey })})`;
      return { queued, skipped };
    });
    after(() => processOutbox().catch(() => {}));
    revalidate();
    return { ok: true, data: res, message: `${res.queued} e-mails queued${res.skipped ? `, ${res.skipped} skipped (no e-mail or opted out)` : ""}` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function stopSequence(enrollmentId: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  try {
    await withUser(user.id, (tx) => tx`update sequence_enrollments set status = 'stopped', stop_reason = 'stopped manually' where id = ${enrollmentId}`);
    revalidate();
    return { ok: true, message: "Follow-ups stopped" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

/** End an A/B test: keep the winning variant active, pause the others (their history stays). */
export async function promoteVariant(key: string, variant: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  if (!/^[a-z0-9_]+$/.test(key) || !/^[A-Z]$/.test(variant)) return { ok: false, error: "Invalid request" };
  try {
    await withUser(user.id, async (tx) => {
      const r = await tx`update email_templates set is_active = (variant = ${variant})
        where department = 'client_relations' and key = ${key} returning id`;
      if (!r.length) throw Object.assign(new Error("Template not found"), { code: "P0002" });
      await tx`select app.log_event('outreach.ab_winner', 'email_template', null, ${tx.json({ key, variant })})`;
    });
    revalidate();
    return { ok: true, message: `Variant ${variant} is now the only active version` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

/** Start a new challenger: copies the current best active variant under the next free letter. */
export async function addVariant(key: string): Promise<ActionResult<{ variant: string }>> {
  const user = await requireRole("client_relations");
  if (!/^[a-z0-9_]+$/.test(key)) return { ok: false, error: "Invalid request" };
  try {
    const variant = await withUser(user.id, async (tx) => {
      const rows = await tx<{ variant: string; name: string; subject: string; body: string; is_active: boolean; trigger_stage: string | null; requires_review: boolean }[]>`
        select variant, name, subject, body, is_active, trigger_stage, requires_review from email_templates
        where department = 'client_relations' and key = ${key} order by is_active desc, variant desc`;
      if (!rows.length) throw Object.assign(new Error("Template not found"), { code: "P0002" });
      const used = new Set(rows.map((r) => r.variant));
      const next = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((c) => !used.has(c));
      if (!next) throw Object.assign(new Error("No free variant letter"), { code: "22023" });
      const base = rows[0];
      await tx`insert into email_templates (department, key, variant, name, subject, body, trigger_stage, requires_review, is_active)
        values ('client_relations', ${key}, ${next}, ${base.name.replace(/\s*\([A-Z]\)$/, "") + ` (${next})`}, ${base.subject}, ${base.body},
                ${base.trigger_stage}, ${base.requires_review}, true)`;
      return next;
    });
    revalidate();
    return { ok: true, data: { variant }, message: `Variant ${variant} created - edit it, then sends are split automatically` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const sequenceSchema = z.object({ id: uuid, steps: z.array(z.object({ after_days: z.number().int().min(1).max(60), template_key: z.string().regex(/^[a-z0-9_]+$/) })).min(1).max(5) });

export async function updateSequence(input: z.infer<typeof sequenceSchema>): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = sequenceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Each step needs 1-60 days and a template" };
  try {
    await withUser(user.id, (tx) => tx`update email_sequences set steps = ${tx.json(p.data.steps)} where id = ${p.data.id} and department = 'client_relations'`);
    revalidate();
    return { ok: true, message: "Follow-up schedule saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
