"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { withService } from "@/lib/db";
import { processOutbox, queueEmail } from "@/lib/email/outbox";
import { renderTemplate } from "@/lib/email/render";
import { storeFile } from "@/lib/storage";

/**
 * Public application form. Applicants never touch the database directly: this server
 * action validates everything, stores the CV privately and writes the records with the
 * service role. Spam protection: honeypot field + minimum fill time.
 */

export type ApplyState = { ok: false; error: string; fieldErrors?: Record<string, string> } | null;

const MAX_CV_BYTES = 5 * 1024 * 1024;
const base = z.object({
  first_name: z.string().trim().min(1, "Required").max(80),
  last_name: z.string().trim().min(1, "Required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail"),
  phone: z.string().trim().max(40).optional(),
  linkedin_url: z.string().trim().max(300).optional().refine((v) => !v || /^https?:\/\/(www\.)?linkedin\.com\//i.test(v), "Must be a linkedin.com URL"),
  nationality: z.string().trim().max(60).optional(),
  university: z.string().trim().min(2, "Required").max(120),
  degree_program: z.string().trim().min(2, "Required").max(120),
  study_year: z.string().trim().min(1, "Required").max(40),
  position_id: z.string().uuid("Choose a track"),
  second_choice_position_id: z.string().uuid().optional().or(z.literal("")),
  heard_from: z.string().trim().max(60).optional(),
  consent: z.literal("on", { message: "Please accept the privacy notice" }),
});

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export async function submitApplication(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  // bots: hidden field filled, or form submitted faster than a human can type
  if (String(form.get("website") ?? "") !== "") return { ok: false, error: "Submission rejected." };
  const started = Number(form.get("started_at") ?? 0);
  if (!started || Date.now() - started < 4000) return { ok: false, error: "Please take a moment to complete the form." };

  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
  const p = base.safeParse(raw);
  if (!p.success) {
    const fieldErrors: Record<string, string> = {};
    p.error.issues.forEach((i) => (fieldErrors[String(i.path[0])] = i.message));
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  const v = p.data;
  const languages = form.getAll("languages").map(String).filter(Boolean).slice(0, 10);
  const cv = form.get("cv");

  const ctx = await withService(async (sql) => {
    const [pos] = await sql<{ id: string; name: string; questions: { key: string; label: string; required: boolean; max_words?: number }[];
      cycle_id: string; cycle_name: string; cycle_slug: string; consent_version: string; is_open: boolean; cycle_open: boolean }[]>`
      select p.id, p.name, p.questions, c.id as cycle_id, c.name as cycle_name, c.slug as cycle_slug, c.privacy_notice_version as consent_version,
             p.is_open, (c.status = 'open' and (c.closes_at is null or c.closes_at > now()) and (c.opens_at is null or c.opens_at <= now())) as cycle_open
      from positions p join recruitment_cycles c on c.id = p.cycle_id where p.id = ${v.position_id}`;
    return pos;
  });
  if (!ctx || !ctx.cycle_open || !ctx.is_open) return { ok: false, error: "This track is not accepting applications right now." };

  const answers: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};
  for (const q of ctx.questions) {
    const a = String(form.get(`q_${q.key}`) ?? "").trim();
    if (q.required && !a) fieldErrors[`q_${q.key}`] = "Required";
    else if (q.max_words && words(a) > q.max_words) fieldErrors[`q_${q.key}`] = `Max. ${q.max_words} words (${words(a)})`;
    answers[q.key] = a.slice(0, 6000);
  }
  let cvBytes: Buffer | null = null;
  if (!(cv instanceof File) || cv.size === 0) fieldErrors.cv = "Please upload your CV (PDF)";
  else if (cv.size > MAX_CV_BYTES) fieldErrors.cv = "Maximum 5 MB";
  else {
    cvBytes = Buffer.from(await cv.arrayBuffer());
    if (cvBytes.subarray(0, 5).toString("latin1") !== "%PDF-") fieldErrors.cv = "The file must be a PDF";
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please check the highlighted fields.", fieldErrors };

  const applicationId = randomUUID();
  let alias = "";
  try {
    const file = await storeFile({ bucket: "applications", path: `${ctx.cycle_slug}/${applicationId}/cv.pdf`,
      filename: `CV_${v.last_name.replace(/[^\w]/g, "")}.pdf`, contentType: "application/pdf", bytes: cvBytes!, createdBy: null });
    alias = await withService(async (sql) => {
      const [person] = await sql<{ id: string }[]>`
        insert into people (first_name, last_name, email, phone, linkedin_url, nationality, city)
        values (${v.first_name}, ${v.last_name}, ${v.email}, ${v.phone ?? null}, ${v.linkedin_url ?? null}, ${v.nationality ?? null}, 'Barcelona')
        on conflict (email) do update set first_name = excluded.first_name, last_name = excluded.last_name,
          phone = coalesce(excluded.phone, people.phone), linkedin_url = coalesce(excluded.linkedin_url, people.linkedin_url),
          nationality = coalesce(excluded.nationality, people.nationality)
        returning id`;
      const dup = await sql`select 1 from applications where cycle_id = ${ctx.cycle_id} and person_id = ${person.id}`;
      if (dup.length) throw Object.assign(new Error("duplicate"), { code: "DUP" });
      await sql`insert into person_roles (person_id, role) values (${person.id}, 'applicant')`;
      const [app] = await sql<{ alias: string }[]>`
        insert into applications (id, cycle_id, position_id, second_choice_position_id, person_id, answers, university, degree_program,
          study_year, languages, heard_from, cv_file_id, consent_at, consent_version)
        values (${applicationId}, ${ctx.cycle_id}, ${v.position_id}, ${v.second_choice_position_id || null}, ${person.id}, ${sql.json(answers)},
          ${v.university}, ${v.degree_program}, ${v.study_year}, ${languages}, ${v.heard_from ?? null}, ${file.id}, now(), ${ctx.consent_version})
        returning alias`;
      await sql`insert into status_history (entity, entity_id, to_status, note) values ('application', ${applicationId}, 'received', 'Submitted via public form')`;
      const [t] = await sql<{ id: string; subject: string; body: string }[]>`
        select id, subject, body from email_templates where department = 'hr' and trigger_stage = 'received' and is_active limit 1`;
      if (t) {
        const vars = { first_name: v.first_name, position: ctx.name, cycle: ctx.cycle_name };
        await queueEmail(sql, { department: "hr", to: v.email, toPersonId: person.id, subject: renderTemplate(t.subject, vars).text,
          body: renderTemplate(t.body, vars).text, templateId: t.id, applicationId, status: "queued" });
      }
      return app.alias;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "DUP") {
      return { ok: false, error: "You have already applied in this cycle. If you want to change your application, please e-mail the HR team." };
    }
    console.error("application submit failed", err);
    return { ok: false, error: "Something went wrong while saving your application. Please try again." };
  }
  after(() => processOutbox().catch(() => {}));
  redirect(`/apply/thanks?ref=${encodeURIComponent(alias)}`);
}
