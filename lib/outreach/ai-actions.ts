"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { dbErrorMessage, withUser } from "@/lib/db";
import { processOutbox, queueEmail, unsubscribeUrl } from "@/lib/email/outbox";
import type { ActionResult } from "@/lib/hr/actions";

function aiError(err: unknown) {
  const msg = (err as Error).message ?? "";
  if (msg.includes("ANTHROPIC_API_KEY")) return "AI is not configured (ANTHROPIC_API_KEY missing)";
  return dbErrorMessage(err) === "Something went wrong. Please try again." ? msg || "AI request failed" : dbErrorMessage(err);
}

export async function draftEmail(leadId: string, templateKey = "first_touch"): Promise<ActionResult<{ subject: string; body: string; to: string | null }>> {
  const user = await requireRole("client_relations");
  try {
    const ctx = await withUser(user.id, async (tx) => {
      const [l] = await tx<{ organization_name: string; sector: string | null; city: string | null; project_idea: string | null; description: string | null;
        primary_contact_name: string | null; primary_contact_email: string | null }[]>`
        select v.organization_name, v.sector, v.city, v.project_idea, o.description, v.primary_contact_name, v.primary_contact_email::text
        from v_leads v join organizations o on o.id = v.organization_id where v.id = ${leadId}`;
      const perf = await tx<{ variant: string; sent: number; replied: number; subject: string; body: string }[]>`
        select t.variant, coalesce(p.sent, 0)::int as sent, coalesce(p.replied, 0)::int as replied, t.subject, t.body
        from email_templates t left join v_template_performance p on p.template_id = t.id
        where t.department = 'client_relations' and t.key = ${templateKey} and t.is_active`;
      return { l, perf };
    });
    if (!ctx.l) return { ok: false, error: "Lead not found" };
    // start from the variant that currently performs best
    const best = [...ctx.perf].sort((a, b) => (b.replied + 1) / (b.sent + 2) - (a.replied + 1) / (a.sent + 2))[0];
    if (!best) return { ok: false, error: "No active template" };
    const { draftOutreachEmail } = await import("@/lib/ai/draft");
    const draft = await draftOutreachEmail({
      leadId, userId: user.id, senderName: user.name, contactFirstName: (ctx.l.primary_contact_name ?? "").split(" ")[0] || "there",
      organization: ctx.l.organization_name, sector: ctx.l.sector, city: ctx.l.city, description: ctx.l.description, projectIdea: ctx.l.project_idea,
      template: { subject: best.subject, body: best.body },
    });
    return { ok: true, data: { ...draft, to: ctx.l.primary_contact_email } };
  } catch (err) {
    return { ok: false, error: aiError(err) };
  }
}

export async function sendLeadEmail(leadId: string, subject: string, body: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = z.object({ subject: z.string().min(3).max(200), body: z.string().min(20).max(8000) }).safeParse({ subject, body });
  if (!p.success) return { ok: false, error: "Subject and body are required" };
  try {
    const r = await withUser(user.id, async (tx) => {
      const [l] = await tx<{ primary_contact_id: string | null; primary_contact_email: string | null; stage: string }[]>`
        select primary_contact_id, primary_contact_email::text, stage::text from v_leads where id = ${leadId}`;
      if (!l?.primary_contact_email) throw Object.assign(new Error("The lead has no primary contact with an e-mail address"), { code: "22023" });
      const finalBody = body.replace("{{unsubscribe_link}}", `Not relevant? Opt out here: ${await unsubscribeUrl(l.primary_contact_email)}`);
      const q = await queueEmail(tx, { department: "client_relations", to: l.primary_contact_email, toPersonId: l.primary_contact_id,
        subject, body: finalBody, leadId, fromUserId: user.id });
      if ("skipped" in q) throw Object.assign(new Error(q.skipped), { code: "22023" });
      if (l.stage === "new") await tx`select app.move_lead(${leadId}, 'contacted', 'E-mail sent from lead page')`;
      return q;
    });
    after(() => processOutbox().catch(() => {}));
    revalidatePath(`/outreach/leads/${leadId}`);
    return { ok: true, message: "id" in r ? "E-mail queued and will be sent in a moment" : "Queued" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function runResearch(input: unknown): Promise<ActionResult<{ runId: string; count: number }>> {
  const user = await requireRole("client_relations");
  const { ResearchCriteria, researchLeads } = await import("@/lib/ai/research");
  const p = ResearchCriteria.safeParse(input);
  if (!p.success) return { ok: false, error: "Choose at least one sector and organisation type" };
  try {
    const exclude = await withUser(user.id, async (tx) => (await tx<{ name: string }[]>`select name from organizations order by created_at desc limit 300`).map((r) => r.name));
    const { runId, suggestions } = await researchLeads(p.data, user.id, exclude);
    const count = await withUser(user.id, async (tx) => {
      let n = 0;
      for (const s of suggestions) {
        // mark suggestions that already exist (same domain or very similar name)
        const [dup] = await tx<{ id: string }[]>`select id from organizations where (domain is not null and domain = app.extract_domain(${s.website}))
          or extensions.similarity(normalized_name, app.normalize_org_name(${s.name})) > 0.7 limit 1`;
        await tx`insert into lead_suggestions (ai_run_id, name, website, domain, org_type, sector, city, rationale, sources, suggested_contact_role, fit_score, status, organization_id)
          values (${runId}, ${s.name}, ${s.website}, app.extract_domain(${s.website}), ${s.org_type}, ${s.sector}, ${s.city}, ${s.rationale},
                  ${tx.json(s.sources)}, ${s.suggested_contact_role}, ${s.fit_score}, ${dup ? "duplicate" : "pending"}, ${dup?.id ?? null})`;
        n++;
      }
      return n;
    });
    revalidatePath("/outreach/research");
    return { ok: true, data: { runId, count }, message: `${count} suggestions ready for review` };
  } catch (err) {
    return { ok: false, error: aiError(err) };
  }
}

export async function decideSuggestion(id: string, decision: "accepted" | "rejected"): Promise<ActionResult<{ leadId?: string }>> {
  const user = await requireRole("client_relations");
  try {
    const leadId = await withUser(user.id, async (tx) => {
      const [s] = await tx<{ name: string; website: string | null; org_type: string | null; sector: string | null; city: string | null; rationale: string; status: string }[]>`
        select name, website, org_type::text, sector, city, rationale, status from lead_suggestions where id = ${id}`;
      if (!s || s.status !== "pending") throw Object.assign(new Error("Already decided"), { code: "22023" });
      if (decision === "rejected") {
        await tx`update lead_suggestions set status = 'rejected', decided_by = ${user.id}, decided_at = now() where id = ${id}`;
        return undefined;
      }
      const [o] = await tx<{ id: string }[]>`insert into organizations (name, website, type, sector, city, description, source)
        values (${s.name}, ${s.website}, ${s.org_type ?? "other"}, ${s.sector}, ${s.city}, ${s.rationale}, 'ai_research') returning id`;
      const [l] = await tx<{ id: string }[]>`insert into leads (organization_id, owner_id, source, next_step, next_step_due)
        values (${o.id}, ${user.id}, 'ai_research', 'Verify facts and find the decision maker', current_date + 2) returning id`;
      await tx`update lead_suggestions set status = 'accepted', organization_id = ${o.id}, decided_by = ${user.id}, decided_at = now() where id = ${id}`;
      return l.id;
    });
    revalidatePath("/outreach", "layout");
    return { ok: true, data: { leadId }, message: decision === "accepted" ? "Added to the pipeline" : "Rejected" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
