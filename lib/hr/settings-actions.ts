"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { dbErrorMessage, withUser } from "@/lib/db";
import type { ActionResult } from "./actions";

const cycleSchema = z.object({
  name: z.string().min(3).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/, "lower-case letters, digits and dashes only"),
  opensAt: z.string().min(10),
  closesAt: z.string().min(10),
  retentionDays: z.coerce.number().int().min(30).max(1095),
  copyFrom: z.string().uuid().optional().or(z.literal("")),
});

/** New cycle; tracks, questions and rubrics are copied from an earlier cycle. */
export async function createCycle(form: FormData): Promise<ActionResult> {
  const user = await requireRole("hr");
  const p = cycleSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };
  const v = p.data;
  try {
    await withUser(user.id, async (tx) => {
      const [c] = await tx<{ id: string }[]>`
        insert into recruitment_cycles (name, slug, opens_at, closes_at, retention_days, status)
        values (${v.name}, ${v.slug}, ${new Date(v.opensAt)}, ${new Date(v.closesAt)}, ${v.retentionDays}, 'draft') returning id`;
      if (v.copyFrom) {
        await tx`insert into positions (cycle_id, name, slug, department, description, places, is_open, questions, screening_rubric_id, interview_rubric_id, position)
                 select ${c.id}, name, slug, department, description, places, true, questions, screening_rubric_id, interview_rubric_id, position
                 from positions where cycle_id = ${v.copyFrom}`;
        await tx`insert into reviewer_pool (cycle_id, user_id, max_reviews, position_ids, is_senior)
                 select ${c.id}, rp.user_id, rp.max_reviews,
                        coalesce((select array_agg(np.id) from positions op join positions np on np.slug = op.slug and np.cycle_id = ${c.id}
                                  where op.id = any(rp.position_ids)), '{}'), rp.is_senior
                 from reviewer_pool rp where rp.cycle_id = ${v.copyFrom}`;
      }
    });
    revalidatePath("/hr", "layout");
    return { ok: true, message: "Cycle created as draft" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function updateCycle(id: string, patch: { status?: "draft" | "open" | "closed" | "archived"; retentionDays?: number;
  blindScreening?: boolean; reviewersPerApplication?: number }): Promise<ActionResult> {
  const user = await requireRole("hr");
  try {
    await withUser(user.id, async (tx) => {
      if (patch.status === "open") {
        // only one cycle can accept applications at a time
        await tx`update recruitment_cycles set status = 'closed' where status = 'open' and id <> ${id}`;
      }
      await tx`update recruitment_cycles set
        status = coalesce(${patch.status ?? null}::cycle_status, status),
        retention_days = coalesce(${patch.retentionDays ?? null}::int, retention_days),
        blind_screening = coalesce(${patch.blindScreening ?? null}::boolean, blind_screening),
        reviewers_per_application = coalesce(${patch.reviewersPerApplication ?? null}::int, reviewers_per_application)
        where id = ${id}`;
      await tx`select app.log_event('cycle.updated', 'cycle', ${id}::uuid, ${tx.json(patch)})`;
    });
    revalidatePath("/hr", "layout");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function updatePosition(id: string, patch: { places?: number | null; isOpen?: boolean }): Promise<ActionResult> {
  const user = await requireRole("hr");
  try {
    await withUser(user.id, (tx) => tx`update positions set
      places = case when ${patch.places === undefined} then places else ${patch.places ?? null}::int end,
      is_open = coalesce(${patch.isOpen ?? null}::boolean, is_open) where id = ${id}`);
    revalidatePath("/hr/settings");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function updateTemplate(id: string, patch: { subject: string; body: string; requiresReview: boolean; isActive: boolean }): Promise<ActionResult> {
  const user = await requireRole("hr");
  const p = z.object({ subject: z.string().min(3).max(200), body: z.string().min(10).max(10000), requiresReview: z.boolean(), isActive: z.boolean() }).safeParse(patch);
  if (!p.success) return { ok: false, error: "Subject and body are required" };
  try {
    await withUser(user.id, (tx) => tx`update email_templates set subject = ${p.data.subject}, body = ${p.data.body},
      requires_review = ${p.data.requiresReview}, is_active = ${p.data.isActive} where id = ${id}`);
    revalidatePath("/hr/settings");
    revalidatePath("/outreach/templates");
    return { ok: true, message: "Template saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
