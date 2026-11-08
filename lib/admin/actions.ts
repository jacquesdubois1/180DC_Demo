"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { APP_ROLES, type AppRole } from "@/lib/auth/roles";
import { dbErrorMessage, withService, withUser } from "@/lib/db";
import type { ActionResult } from "@/lib/hr/actions";
import { runRetention } from "@/lib/jobs/retention";
import { deleteFileContent } from "@/lib/storage";

const uuid = z.string().uuid();
const fail = (message: string) => Object.assign(new Error(message), { code: "22023" });

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------
export async function setUserRoles(userId: string, roles: AppRole[]): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(userId).success || !roles.every((r) => (APP_ROLES as readonly string[]).includes(r))) return { ok: false, error: "Invalid request" };
  const next = [...new Set<AppRole>(["member", ...roles])];
  try {
    await withUser(admin.id, async (tx) => {
      if (userId === admin.id && !next.includes("admin")) throw fail("You cannot remove your own admin role - ask another admin.");
      if (!next.includes("admin")) {
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from user_roles r join app_users u on u.id = r.user_id
          where r.role = 'admin' and u.is_active and r.user_id <> ${userId}`;
        if (n === 0) throw fail("There must always be at least one active admin.");
      }
      const before = (await tx<{ role: string }[]>`select role::text from user_roles where user_id = ${userId}`).map((r) => r.role);
      await tx`delete from user_roles where user_id = ${userId} and not (role::text = any(${next}))`;
      for (const r of next) await tx`insert into user_roles (user_id, role, granted_by) values (${userId}, ${r}, ${admin.id}) on conflict do nothing`;
      await tx`select app.log_event('admin.roles_changed', 'app_user', ${userId}, ${tx.json({ before, after: next })})`;
    });
    revalidatePath("/admin/users");
    return { ok: true, message: "Roles updated - effective on the user's next page load" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid request" };
  if (userId === admin.id && !active) return { ok: false, error: "You cannot deactivate yourself." };
  try {
    await withUser(admin.id, async (tx) => {
      await tx`update app_users set is_active = ${active} where id = ${userId}`;
      if (!active) {
        // open work must not silently disappear with the person
        await tx`delete from application_reviewers ar where ar.reviewer_id = ${userId}
          and not exists (select 1 from reviews r where r.application_id = ar.application_id and r.reviewer_id = ar.reviewer_id
                          and r.stage = ar.stage and r.submitted_at is not null)`;
      }
      await tx`select app.log_event(${active ? "admin.user_reactivated" : "admin.user_deactivated"}, 'app_user', ${userId}, '{}'::jsonb)`;
    });
    revalidatePath("/admin/users");
    return { ok: true, message: active ? "User reactivated" : "User deactivated - open review assignments were released" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const profileSchema = z.object({
  department: z.enum(["board", "hr", "client_relations", "consulting", "analytics", "events", "finance", "marketing", "other"]),
  title: z.string().max(80),
});

export async function updateUserProfile(userId: string, input: z.infer<typeof profileSchema>): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const p = profileSchema.safeParse(input);
  if (!p.success || !uuid.safeParse(userId).success) return { ok: false, error: "Invalid request" };
  try {
    await withUser(admin.id, (tx) => tx`update app_users set department = ${p.data.department}, title = ${p.data.title || null} where id = ${userId}`);
    revalidatePath("/admin/users");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Privacy (GDPR)
// ---------------------------------------------------------------------------
export async function runRetentionNow(): Promise<ActionResult> {
  await requireRole("admin");
  try {
    const r = await runRetention();
    revalidatePath("/admin/privacy");
    return { ok: true, message: r.anonymized ? `${r.anonymized} application(s) anonymised` : "Nothing to anonymise - all data is within its retention period" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

/** Right to erasure (Art. 17): the admin types the e-mail address again to confirm. */
export async function erasePerson(email: string, confirmation: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const e = email.trim().toLowerCase();
  if (!e || e !== confirmation.trim().toLowerCase()) return { ok: false, error: "Type the e-mail address again to confirm" };
  try {
    const files = await withUser(admin.id, async (tx) => {
      const [p] = await tx<{ id: string }[]>`select id from people where email = ${e}`;
      if (!p) throw Object.assign(new Error("No person with this e-mail address"), { code: "P0002" });
      const stored = await tx<{ bucket: string; path: string; storage_backend: string }[]>`
        select f.bucket, f.path, f.storage_backend from files f join applications a on a.cv_file_id = f.id
        where a.person_id = ${p.id} and f.storage_backend <> 'database'`;
      await tx`select app.erase_person(${p.id})`;
      return stored;
    });
    for (const f of files) await deleteFileContent(f).catch(() => {});
    revalidatePath("/admin/privacy");
    return { ok: true, message: "Person erased: profile deleted, applications anonymised, address added to the suppression list" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function removeSuppression(id: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request" };
  try {
    await withUser(admin.id, async (tx) => {
      const [s] = await tx<{ reason: string }[]>`select reason from email_suppressions where id = ${id}`;
      if (s?.reason === "gdpr_erasure") throw fail("Erasure requests stay on the list permanently.");
      await tx`delete from email_suppressions where id = ${id}`;
      await tx`select app.log_event('admin.suppression_removed', 'email_suppression', ${id}, '{}'::jsonb)`;
    });
    revalidatePath("/admin/privacy");
    return { ok: true, message: "Removed from the suppression list" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export async function retryFailedEmails(): Promise<ActionResult> {
  const admin = await requireRole("admin");
  try {
    const n = await withService(async (tx) => {
      const r = await tx`update email_outbox set status = 'queued', attempts = 0, scheduled_for = now(), last_error = null
        where status = 'failed' returning id`;
      await tx`select app.log_event('admin.emails_retried', 'system', null, ${tx.json({ count: r.length, by: admin.id })})`;
      return r.length;
    });
    revalidatePath("/admin/system");
    return { ok: true, message: `${n} e-mail(s) queued again` };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
