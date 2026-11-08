import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ApplicationStage } from "./stages";

export interface Cycle {
  id: string; name: string; slug: string; status: string; opens_at: string | null; closes_at: string | null;
  retention_days: number; blind_screening: boolean; reviewers_per_application: number; applications: number;
}
export interface Position {
  id: string; cycle_id: string; name: string; slug: string; department: string; places: number | null; is_open: boolean;
  description: string | null; questions: { key: string; label: string; type: string; required: boolean; max_words?: number }[];
  screening_rubric_id: string | null; interview_rubric_id: string | null;
}
export interface ApplicationRow {
  id: string; cycle_id: string; cycle_name: string; position_id: string; position_name: string; position_slug: string;
  stage: ApplicationStage; alias: string; person_id: string | null; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; linkedin_url: string | null; nationality: string | null;
  university: string | null; degree_program: string | null; study_year: string | null; languages: string[];
  heard_from: string | null; cv_file_id: string | null; has_extraction: boolean; submitted_at: string;
  stage_changed_at: string; days_in_stage: number; decided_at: string | null; decision_reason: string | null; anonymized_at: string | null;
  reviewers_assigned: number; reviews_submitted: number; avg_score: number | null; yes_votes: number; maybe_votes: number; no_votes: number;
}

export async function getCycles(user: CurrentUser): Promise<Cycle[]> {
  return withUser(user.id, (sql) => sql<Cycle[]>`
    select c.id, c.name, c.slug, c.status::text, c.opens_at, c.closes_at, c.retention_days, c.blind_screening,
           c.reviewers_per_application, (select count(*)::int from applications a where a.cycle_id = c.id) as applications
    from recruitment_cycles c order by c.opens_at desc nulls last`);
}

/** The cycle chosen in the URL (?cycle=slug), else the open one, else the latest. */
export async function resolveCycle(user: CurrentUser, slug?: string | string[]): Promise<{ cycle: Cycle; cycles: Cycle[] }> {
  const cycles = await getCycles(user);
  const s = Array.isArray(slug) ? slug[0] : slug;
  const cycle = cycles.find((c) => c.slug === s) ?? cycles.find((c) => c.status === "open") ?? cycles[0];
  return { cycle, cycles };
}

export async function getPositions(user: CurrentUser, cycleId: string): Promise<Position[]> {
  return withUser(user.id, (sql) => sql<Position[]>`
    select id, cycle_id, name, slug, department::text, places, is_open, description, questions, screening_rubric_id, interview_rubric_id
    from positions where cycle_id = ${cycleId} order by position`);
}

export async function getApplications(user: CurrentUser, cycleId: string, f: { q?: string; position?: string; stage?: string } = {}) {
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  return withUser(user.id, (sql) => sql<ApplicationRow[]>`
    select * from v_applications
    where cycle_id = ${cycleId}
      and anonymized_at is null
      and (${f.position ?? null}::text is null or position_slug = ${f.position ?? null})
      and (${f.stage ?? null}::text is null or stage::text = ${f.stage ?? null})
      and (${q}::text is null or lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email::text,'')
           || ' ' || coalesce(university,'') || ' ' || alias) like ${q})
    order by submitted_at desc`);
}

export async function getApplicationDetail(user: CurrentUser, id: string) {
  return withUser(user.id, async (sql) => {
    const [app] = await sql<(ApplicationRow & { answers: Record<string, string>; extracted: Record<string, unknown> | null; extracted_at: string | null; consent_at: string; consent_version: string; offer_sent_at: string | null; offer_responded_at: string | null; second_choice: string | null; blind_screening: boolean })[]>`
      select v.*, a.answers, a.extracted, a.extracted_at, a.consent_at, a.consent_version, a.offer_sent_at, a.offer_responded_at,
             (select name from positions p2 where p2.id = a.second_choice_position_id) as second_choice, c.blind_screening
      from v_applications v join applications a on a.id = v.id join recruitment_cycles c on c.id = a.cycle_id
      where v.id = ${id}`;
    if (!app) return null;
    const [position] = await sql<Position[]>`select id, cycle_id, name, slug, department::text, places, is_open, description, questions,
      screening_rubric_id, interview_rubric_id from positions where id = ${app.position_id}`;
    const reviews = await sql<{ id: string; reviewer_id: string; reviewer_name: string; stage: string; scores: Record<string, number>;
      recommendation: string | null; comment: string | null; submitted_at: string | null }[]>`
      select r.id, r.reviewer_id, u.display_name as reviewer_name, r.stage::text, r.scores, r.recommendation::text, r.comment, r.submitted_at
      from reviews r join app_users u on u.id = r.reviewer_id where r.application_id = ${id} order by r.stage, r.submitted_at nulls last`;
    const assigned = await sql<{ reviewer_id: string; reviewer_name: string; stage: string; due_at: string | null; assignment_method: string }[]>`
      select ar.reviewer_id, u.display_name as reviewer_name, ar.stage::text, ar.due_at, ar.assignment_method
      from application_reviewers ar join app_users u on u.id = ar.reviewer_id where ar.application_id = ${id} order by ar.stage, u.display_name`;
    const criteria = await sql<{ rubric_id: string; key: string; label: string; weight: number; stage: string }[]>`
      select rc.rubric_id, rc.key, rc.label, rc.weight, r.stage::text from rubric_criteria rc join rubrics r on r.id = rc.rubric_id
      where rc.rubric_id in (${position.screening_rubric_id}, ${position.interview_rubric_id}) order by r.stage, rc.position`;
    const comments = await sql<{ id: string; author_name: string; body: string; visibility: string; created_at: string }[]>`
      select c.id, u.display_name as author_name, c.body, c.visibility, c.created_at
      from application_comments c join app_users u on u.id = c.author_id where c.application_id = ${id} order by c.created_at desc`;
    const history = await sql<{ from_status: string | null; to_status: string; note: string | null; changed_at: string; changed_by_name: string | null }[]>`
      select h.from_status, h.to_status, h.note, h.changed_at, u.display_name as changed_by_name
      from status_history h left join app_users u on u.id = h.changed_by
      where h.entity = 'application' and h.entity_id = ${id} order by h.changed_at desc`;
    const interviews = await sql<{ id: string; round: number; scheduled_at: string; duration_minutes: number; format: string; location: string | null; status: string; interviewers: string[] }[]>`
      select i.id, i.round, i.scheduled_at, i.duration_minutes, i.format, i.location, i.status,
             coalesce((select array_agg(u.display_name) from app_users u where u.id = any(i.interviewer_ids)), '{}') as interviewers
      from interviews i where i.application_id = ${id} order by i.scheduled_at`;
    const emails = await sql<{ id: string; subject: string; status: string; created_at: string; sent_at: string | null; body_text: string }[]>`
      select id, subject, status::text, created_at, sent_at, body_text from email_outbox where application_id = ${id} order by created_at desc`;
    const conflicts = await sql<{ reviewer_name: string; reason: string | null }[]>`
      select u.display_name as reviewer_name, c.reason from review_conflicts c join app_users u on u.id = c.reviewer_id
      where c.application_id = ${id}`;
    return { app, position, reviews, assigned, criteria, comments, history, interviews, emails, conflicts };
  });
}

export async function getReviewerPool(user: CurrentUser, cycleId: string) {
  return withUser(user.id, (sql) => sql<{ user_id: string; display_name: string; title: string | null; max_reviews: number; position_ids: string[]; is_senior: boolean; assigned: number; submitted: number; open: number }[]>`
    select p.user_id, u.display_name, u.title, p.max_reviews, p.position_ids::text[] as position_ids, p.is_senior,
           (select count(*)::int from application_reviewers ar join applications a on a.id = ar.application_id
             where ar.reviewer_id = p.user_id and a.cycle_id = ${cycleId}
               and not exists (select 1 from reviews r where r.application_id = ar.application_id and r.reviewer_id = ar.reviewer_id
                               and r.stage = ar.stage and r.submitted_at is not null)) as open,
           (select count(*)::int from application_reviewers ar join applications a on a.id = ar.application_id
             where ar.reviewer_id = p.user_id and a.cycle_id = ${cycleId}) as assigned,
           (select count(*)::int from reviews r join applications a on a.id = r.application_id
             where r.reviewer_id = p.user_id and a.cycle_id = ${cycleId} and r.submitted_at is not null) as submitted
    from reviewer_pool p join app_users u on u.id = p.user_id
    where p.cycle_id = ${cycleId} order by u.display_name`);
}

/** All submitted reviews of a cycle with rubric weights, for calibration and agreement statistics. */
export async function getCycleReviews(user: CurrentUser, cycleId: string, stage: "screening" | "interview") {
  return withUser(user.id, async (sql) => {
    const reviews = await sql<{ application_id: string; reviewer_id: string; scores: Record<string, number>; recommendation: string }[]>`
      select r.application_id, r.reviewer_id, r.scores, r.recommendation::text
      from reviews r join applications a on a.id = r.application_id
      where a.cycle_id = ${cycleId} and r.stage = ${stage} and r.submitted_at is not null`;
    const criteria = await sql<{ key: string; label: string; weight: number }[]>`
      select distinct on (rc.key) rc.key, rc.label, rc.weight from rubric_criteria rc join rubrics r on r.id = rc.rubric_id
      where r.stage = ${stage} order by rc.key`;
    return { reviews, criteria };
  });
}
