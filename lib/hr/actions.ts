"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth";
import { optimizeAssignment, type AssignResult } from "@/lib/analytics/assignment";
import { dbErrorMessage, type Tx, withUser } from "@/lib/db";
import { processOutbox, queueEmail } from "@/lib/email/outbox";
import { renderTemplate } from "@/lib/email/render";
import { APPLICATION_STAGES, type ApplicationStage } from "./stages";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const uuid = z.string().uuid();

/** Queue the template configured for a stage (decision e-mails wait for HR review). */
async function queueStageEmail(tx: Tx, applicationId: string, stage: ApplicationStage, senderId: string, senderName: string) {
  const [t] = await tx<{ id: string; subject: string; body: string; requires_review: boolean }[]>`
    select id, subject, body, requires_review from email_templates
    where department = 'hr' and trigger_stage = ${stage} and is_active order by variant limit 1`;
  if (!t) return null;
  const [a] = await tx<{ email: string | null; first_name: string | null; person_id: string | null; position_name: string; cycle_name: string }[]>`
    select email::text, first_name, person_id, position_name, cycle_name from v_applications where id = ${applicationId}`;
  if (!a?.email) return null;
  const vars = { first_name: a.first_name, position: a.position_name, cycle: a.cycle_name, sender_name: senderName,
    scheduling_link: "(HR will add your interview slots)" };
  const subject = renderTemplate(t.subject, vars).text;
  const body = renderTemplate(t.body, vars).text;
  return queueEmail(tx, { department: "hr", to: a.email, toPersonId: a.person_id, subject, body, templateId: t.id,
    applicationId, fromUserId: senderId, status: t.requires_review ? "needs_review" : "queued" });
}

export async function moveApplication(applicationId: string, to: ApplicationStage, note?: string): Promise<ActionResult> {
  const user = await requireRole("hr");
  const parsed = z.object({ id: uuid, to: z.enum(APPLICATION_STAGES), note: z.string().max(2000).optional() }).safeParse({ id: applicationId, to, note });
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const queued = await withUser(user.id, async (tx) => {
      await tx`select app.move_application(${applicationId}, ${to}::application_stage, ${note?.trim() || null})`;
      return queueStageEmail(tx, applicationId, to, user.id, user.name);
    });
    after(() => processOutbox().catch(() => {}));
    revalidatePath("/hr", "layout");
    const emailNote = queued && "id" in queued ? " An e-mail was prepared - review it on the candidate page." : "";
    return { ok: true, message: `Moved to ${to.replace("_", " ")}.${emailNote}` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function addComment(applicationId: string, body: string, visibility: "hr" | "reviewers" = "hr"): Promise<ActionResult> {
  const user = await requireUser();
  const text = body.trim();
  if (!text || text.length > 5000) return { ok: false, error: "Comment must be 1-5000 characters" };
  try {
    await withUser(user.id, (tx) => tx`insert into application_comments (application_id, author_id, body, visibility)
      values (${applicationId}, ${user.id}, ${text}, ${visibility})`);
    revalidatePath(`/hr/applications/${applicationId}`);
    revalidatePath(`/reviews/${applicationId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const reviewSchema = z.object({
  applicationId: uuid,
  stage: z.enum(["screening", "interview"]),
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  recommendation: z.enum(["strong_yes", "yes", "maybe", "no"]).nullable(),
  comment: z.string().max(5000).optional(),
  submit: z.boolean(),
});

export async function saveReview(input: z.infer<typeof reviewSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const p = reviewSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Please check the scores" };
  const v = p.data;
  try {
    await withUser(user.id, async (tx) => {
      const criteria = await tx<{ key: string }[]>`
        select rc.key from applications a join positions p on p.id = a.position_id
        join rubric_criteria rc on rc.rubric_id = case ${v.stage} when 'screening' then p.screening_rubric_id else p.interview_rubric_id end
        where a.id = ${v.applicationId}`;
      // assigned reviewers only see applications through app.my_review_assignments(); fall back to that
      const keys = criteria.length ? criteria.map((c) => c.key)
        : (await tx<{ key: string }[]>`select rc.key from app.my_review_assignments() m join rubric_criteria rc on rc.rubric_id = m.rubric_id
            where m.application_id = ${v.applicationId} and m.review_stage = ${v.stage}`).map((c) => c.key);
      if (v.submit) {
        const missing = keys.filter((k) => !(k in v.scores));
        if (missing.length) throw Object.assign(new Error(`Please score every criterion (${missing.length} missing)`), { code: "22023" });
        if (!v.recommendation) throw Object.assign(new Error("Please choose a recommendation"), { code: "22023" });
      }
      const existing = await tx<{ id: string; submitted_at: string | null }[]>`
        select id, submitted_at from reviews where application_id = ${v.applicationId} and reviewer_id = ${user.id} and stage = ${v.stage}`;
      if (existing[0]?.submitted_at) throw Object.assign(new Error("This review was already submitted"), { code: "22023" });
      await tx`
        insert into reviews (application_id, reviewer_id, stage, scores, recommendation, comment, submitted_at)
        values (${v.applicationId}, ${user.id}, ${v.stage}, ${tx.json(v.scores)}, ${v.recommendation}, ${v.comment?.trim() || null},
                ${v.submit ? new Date() : null})
        on conflict (application_id, reviewer_id, stage) do update set scores = excluded.scores,
          recommendation = excluded.recommendation, comment = excluded.comment, submitted_at = excluded.submitted_at`;
    });
    revalidatePath("/reviews", "layout");
    return { ok: true, message: v.submit ? "Review submitted. Other reviewers' scores are now visible to you." : "Draft saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function declareConflict(applicationId: string, reason: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, async (tx) => {
      await tx`insert into review_conflicts (reviewer_id, application_id, reason) values (${user.id}, ${applicationId}, ${reason.slice(0, 500)})
               on conflict do nothing`;
      await tx`select app.log_event('review.conflict_declared', 'application', ${applicationId}::uuid, '{}'::jsonb)`;
    });
    revalidatePath("/reviews", "layout");
    return { ok: true, message: "Conflict declared. HR will reassign this application." };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function setReviewers(applicationId: string, stage: "screening" | "interview", reviewerIds: string[]): Promise<ActionResult> {
  const user = await requireRole("hr");
  try {
    await withUser(user.id, async (tx) => {
      await tx`delete from application_reviewers where application_id = ${applicationId} and stage = ${stage}
               and reviewer_id <> all(${reviewerIds}::uuid[])
               and not exists (select 1 from reviews r where r.application_id = ${applicationId} and r.reviewer_id = application_reviewers.reviewer_id
                               and r.stage = ${stage} and r.submitted_at is not null)`;
      for (const r of reviewerIds) {
        await tx`insert into application_reviewers (application_id, reviewer_id, stage, assigned_by, due_at)
                 values (${applicationId}, ${r}, ${stage}, ${user.id}, now() + interval '5 days') on conflict do nothing`;
      }
    });
    revalidatePath(`/hr/applications/${applicationId}`);
    return { ok: true, message: "Reviewers updated" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function proposeAssignment(cycleId: string, stage: "screening" | "interview", requireSenior: boolean): Promise<ActionResult<AssignResult & { names: Record<string, string> }>> {
  const user = await requireRole("hr");
  const data = await withUser(user.id, async (tx) => {
    const [cycle] = await tx<{ reviewers_per_application: number }[]>`select reviewers_per_application from recruitment_cycles where id = ${cycleId}`;
    const k = cycle?.reviewers_per_application ?? 2;
    const stageFilter = stage === "screening" ? ["received", "screening"] : ["interview"];
    const apps = await tx<{ id: string; position_id: string; alias: string; assigned: string[] }[]>`
      select a.id, a.position_id, a.alias,
             coalesce(array_agg(ar.reviewer_id::text) filter (where ar.reviewer_id is not null), '{}') as assigned
      from applications a left join application_reviewers ar on ar.application_id = a.id and ar.stage = ${stage}
      where a.cycle_id = ${cycleId} and a.stage::text = any(${stageFilter}) and a.anonymized_at is null
      group by a.id`;
    const pool = await tx<{ user_id: string; display_name: string; max_reviews: number; position_ids: string[]; is_senior: boolean; load: number }[]>`
      select p.user_id, u.display_name, p.max_reviews, p.position_ids::text[] as position_ids, p.is_senior,
             -- capacity limits OPEN scorecards (assigned, not yet submitted); finished work no longer counts
             (select count(*)::int from application_reviewers ar join applications a on a.id = ar.application_id
               where ar.reviewer_id = p.user_id and a.cycle_id = ${cycleId}
                 and not exists (select 1 from reviews r where r.application_id = ar.application_id and r.reviewer_id = ar.reviewer_id
                                 and r.stage = ar.stage and r.submitted_at is not null)) as load
      from reviewer_pool p join app_users u on u.id = p.user_id where p.cycle_id = ${cycleId} and u.is_active`;
    const conflicts = await tx<{ reviewer_id: string; application_id: string }[]>`
      select c.reviewer_id, c.application_id from review_conflicts c join applications a on a.id = c.application_id where a.cycle_id = ${cycleId}`;
    return { apps, pool, conflicts, k };
  });
  const result = await optimizeAssignment({
    apps: data.apps.map((a) => ({ id: a.id, positionId: a.position_id, needed: Math.max(0, data.k - a.assigned.length), alreadyAssigned: a.assigned })),
    reviewers: data.pool.map((r) => ({ id: r.user_id, capacity: r.max_reviews, currentLoad: r.load, expertise: r.position_ids, senior: r.is_senior })),
    conflicts: data.conflicts.map((c) => ({ reviewerId: c.reviewer_id, applicationId: c.application_id })),
    requireSenior,
  });
  const names: Record<string, string> = {};
  data.pool.forEach((r) => (names[r.user_id] = r.display_name));
  data.apps.forEach((a) => (names[a.id] = a.alias));
  return { ok: true, data: { ...result, names } };
}

export async function applyAssignment(stage: "screening" | "interview", pairs: { applicationId: string; reviewerId: string }[]): Promise<ActionResult> {
  const user = await requireRole("hr");
  const p = z.array(z.object({ applicationId: uuid, reviewerId: uuid })).max(2000).safeParse(pairs);
  if (!p.success) return { ok: false, error: "Invalid assignment" };
  try {
    const n = await withUser(user.id, async (tx) => {
      let count = 0;
      for (const pr of p.data) {
        const r = await tx`insert into application_reviewers (application_id, reviewer_id, stage, assigned_by, due_at, assignment_method)
          values (${pr.applicationId}, ${pr.reviewerId}, ${stage}, ${user.id}, now() + interval '5 days', 'optimizer') on conflict do nothing`;
        count += r.count;
      }
      // applications that now have reviewers move from "New" into "In review"
      if (stage === "screening") {
        const ids = [...new Set(p.data.map((x) => x.applicationId))];
        const fresh = await tx<{ id: string }[]>`select id from applications where id = any(${ids}::uuid[]) and stage = 'received'`;
        for (const f of fresh) await tx`select app.move_application(${f.id}, 'screening', 'Reviewers assigned')`;
      }
      await tx`select app.log_event('review.assignment_applied', 'cycle', null, ${tx.json({ pairs: count, stage })})`;
      return count;
    });
    revalidatePath("/hr", "layout");
    return { ok: true, message: `${n} assignments created` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const interviewSchema = z.object({
  applicationId: uuid,
  scheduledAt: z.string().min(10),
  durationMinutes: z.coerce.number().int().min(10).max(240),
  format: z.enum(["online", "in_person"]),
  location: z.string().max(300).optional(),
  interviewerIds: z.array(uuid).min(1).max(4),
});

export async function scheduleInterview(input: z.infer<typeof interviewSchema>): Promise<ActionResult> {
  const user = await requireRole("hr");
  const p = interviewSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Please fill in date, duration and at least one interviewer" };
  const v = p.data;
  try {
    await withUser(user.id, async (tx) => {
      await tx`insert into interviews (application_id, scheduled_at, duration_minutes, format, location, interviewer_ids)
        values (${v.applicationId}, ${new Date(v.scheduledAt)}, ${v.durationMinutes}, ${v.format}, ${v.location || null}, ${v.interviewerIds}::uuid[])`;
      for (const r of v.interviewerIds) {
        await tx`insert into application_reviewers (application_id, reviewer_id, stage, assigned_by, due_at)
          values (${v.applicationId}, ${r}, 'interview', ${user.id}, ${new Date(new Date(v.scheduledAt).getTime() + 2 * 864e5)})
          on conflict do nothing`;
      }
    });
    revalidatePath(`/hr/applications/${v.applicationId}`);
    revalidatePath("/hr/interviews");
    return { ok: true, message: "Interview scheduled; the interviewers got an interview scorecard." };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function reviewEmail(outboxId: string, decision: "send" | "cancel", edits?: { subject: string; body: string }): Promise<ActionResult> {
  const user = await requireRole("hr");
  try {
    await withUser(user.id, async (tx) => {
      if (decision === "cancel") {
        await tx`update email_outbox set status = 'cancelled' where id = ${outboxId} and status in ('needs_review', 'draft', 'queued')`;
      } else {
        await tx`update email_outbox set status = 'queued', scheduled_for = now(),
                 subject = coalesce(${edits?.subject ?? null}, subject), body_text = coalesce(${edits?.body ?? null}, body_text)
                 where id = ${outboxId} and status in ('needs_review', 'draft')`;
      }
    });
    after(() => processOutbox().catch(() => {}));
    revalidatePath("/hr", "layout");
    return { ok: true, message: decision === "send" ? "E-mail approved and queued" : "E-mail cancelled" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// AI-assisted CV extraction (suggestions only; HR confirms what is copied)
// ---------------------------------------------------------------------------
export async function extractCv(applicationId: string): Promise<ActionResult> {
  const user = await requireRole("hr");
  const { extractCvFacts } = await import("@/lib/ai/cv");
  try {
    const [app] = await withUser(user.id, (tx) => tx<{ cv_file_id: string | null }[]>`select cv_file_id from applications where id = ${applicationId}`);
    if (!app?.cv_file_id) return { ok: false, error: "No CV attached" };
    const facts = await extractCvFacts({ applicationId, fileId: app.cv_file_id, userId: user.id });
    await withUser(user.id, async (tx) => {
      await tx`update applications set extracted = ${tx.json({ ...facts, _source: "ai", _model: process.env.AI_MODE === "live" ? process.env.AI_MODEL ?? "claude-opus-5-5" : "demo-offline" })},
               extracted_at = now() where id = ${applicationId}`;
      await tx`select app.log_event('application.cv_extracted', 'application', ${applicationId}::uuid, '{}'::jsonb)`;
    });
    revalidatePath(`/hr/applications/${applicationId}`);
    return { ok: true, message: "CV facts extracted - please verify before using them" };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, error: msg.includes("ANTHROPIC_API_KEY") ? "AI is not configured (ANTHROPIC_API_KEY missing)" : dbErrorMessage(err) === "Something went wrong. Please try again." ? msg : dbErrorMessage(err) };
  }
}

export async function applyExtraction(applicationId: string, fields: ("linkedin_url" | "nationality")[]): Promise<ActionResult> {
  const user = await requireRole("hr");
  try {
    await withUser(user.id, async (tx) => {
      const [a] = await tx<{ person_id: string; extracted: Record<string, string | null> | null }[]>`
        select person_id, extracted from applications where id = ${applicationId}`;
      if (!a?.extracted || !a.person_id) throw Object.assign(new Error("Nothing to apply"), { code: "22023" });
      if (fields.includes("linkedin_url") && a.extracted.linkedin_url) {
        await tx`update people set linkedin_url = ${a.extracted.linkedin_url} where id = ${a.person_id}`;
      }
      if (fields.includes("nationality") && a.extracted.nationality) {
        await tx`update people set nationality = ${a.extracted.nationality} where id = ${a.person_id}`;
      }
    });
    revalidatePath(`/hr/applications/${applicationId}`);
    return { ok: true, message: "Profile updated" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
