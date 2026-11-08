import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { LeadStage } from "./stages";

export interface LeadRow {
  id: string; organization_id: string; organization_name: string; organization_type: string; sector: string | null; city: string | null;
  size_band: string | null; website: string | null; domain: string | null; organization_do_not_contact: boolean;
  owner_id: string | null; owner_name: string | null; stage: LeadStage; source: string; priority: number; project_idea: string | null;
  next_step: string | null; next_step_due: string | null; lost_reason: string | null; stage_changed_at: string; created_at: string;
  last_activity_at: string; days_since_activity: number; is_overdue: boolean;
  primary_contact_id: string | null; primary_contact_name: string | null; primary_contact_email: string | null;
  primary_contact_title: string | null; primary_contact_is_alumni: boolean;
  fit_score: number | null; reply_probability: number | null; win_probability: number | null;
}

export interface LeadFilters { q?: string; owner?: string; stage?: string; overdue?: boolean; stale?: boolean; minFit?: number }

export async function getLeads(user: CurrentUser, f: LeadFilters = {}) {
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  return withUser(user.id, (sql) => sql<LeadRow[]>`
    select * from v_leads
    where (${q}::text is null or lower(organization_name || ' ' || coalesce(primary_contact_name, '') || ' ' || coalesce(sector, '') || ' ' || coalesce(city, '')) like ${q})
      and (${f.owner ?? null}::uuid is null or owner_id = ${f.owner ?? null})
      and (${f.stage ?? null}::text is null or stage::text = ${f.stage ?? null})
      and (${f.overdue ?? false} = false or is_overdue)
      and (${f.stale ?? false} = false or (days_since_activity > 14 and stage in ('contacted','follow_up','replied','meeting','proposal')))
      and (${f.minFit ?? null}::numeric is null or fit_score >= ${f.minFit ?? null})
    order by is_overdue desc, next_step_due nulls last, fit_score desc nulls last`);
}

export async function getLeadDetail(user: CurrentUser, id: string) {
  return withUser(user.id, async (sql) => {
    const [lead] = await sql<(LeadRow & { description: string | null; impact_areas: string[]; components: Record<string, number | string> | null; handed_over_to: string | null })[]>`
      select v.*, o.description, o.impact_areas, s.components, l.handed_over_to
      from v_leads v join organizations o on o.id = v.organization_id join leads l on l.id = v.id
      left join lead_scores s on s.lead_id = v.id where v.id = ${id}`;
    if (!lead) return null;
    const contacts = await sql<{ person_id: string; name: string; email: string | null; title: string | null; is_esade_alumni: boolean;
      do_not_contact: boolean; linkedin_url: string | null; is_primary: boolean }[]>`
      select p.id as person_id, p.first_name || ' ' || p.last_name as name, p.email::text, pr.title, pr.is_esade_alumni, p.do_not_contact,
             p.linkedin_url, coalesce(lc.is_primary, false) as is_primary
      from person_roles pr join people p on p.id = pr.person_id
      left join lead_contacts lc on lc.person_id = p.id and lc.lead_id = ${id}
      where pr.organization_id = ${lead.organization_id} and pr.role = 'contact' and pr.end_date is null
      order by lc.is_primary desc nulls last, p.last_name`;
    const interactions = await sql<{ id: string; type: string; occurred_at: string; subject: string | null; summary: string | null;
      template_variant: string | null; author: string | null; person: string | null }[]>`
      select i.id, i.type::text, i.occurred_at, i.subject, i.summary, i.template_variant,
             (select display_name from app_users u where u.id = i.created_by) as author,
             (select first_name || ' ' || last_name from people p where p.id = i.person_id) as person
      from interactions i where i.organization_id = ${lead.organization_id} order by i.occurred_at desc`;
    const emails = await sql<{ id: string; subject: string; status: string; to_email: string; scheduled_for: string; sent_at: string | null; body_text: string }[]>`
      select id, subject, status::text, to_email::text, scheduled_for, sent_at, body_text from email_outbox where lead_id = ${id} order by created_at desc`;
    const history = await sql<{ from_status: string | null; to_status: string; note: string | null; changed_at: string; by: string | null }[]>`
      select h.from_status, h.to_status, h.note, h.changed_at, (select display_name from app_users u where u.id = h.changed_by) as by
      from status_history h where h.entity = 'lead' and h.entity_id = ${id} order by h.changed_at desc`;
    const enrollments = await sql<{ id: string; sequence: string; step_index: number; next_run_at: string; status: string; stop_reason: string | null; steps: { after_days: number; template_key: string }[] }[]>`
      select e.id, s.name as sequence, e.step_index, e.next_run_at, e.status, e.stop_reason, s.steps
      from sequence_enrollments e join email_sequences s on s.id = e.sequence_id where e.lead_id = ${id}`;
    const otherLeads = await sql<{ id: string; stage: string; created_at: string; lost_reason: string | null }[]>`
      select id, stage::text, created_at, lost_reason from leads where organization_id = ${lead.organization_id} and id <> ${id} order by created_at desc`;
    return { lead, contacts, interactions, emails, history, enrollments, otherLeads };
  });
}

export async function getOutreachTeam(user: CurrentUser) {
  return withUser(user.id, (sql) => sql<{ id: string; display_name: string }[]>`
    select u.id, u.display_name from app_users u join user_roles r on r.user_id = u.id
    where r.role in ('client_relations', 'admin') and u.is_active group by u.id order by u.display_name`);
}

export async function getTemplates(user: CurrentUser) {
  return withUser(user.id, (sql) => sql<{ id: string; key: string; variant: string; name: string; subject: string; body: string; is_active: boolean; requires_review: boolean; trigger_stage: string | null }[]>`
    select id, key, variant, name, subject, body, is_active, requires_review, trigger_stage from email_templates
    where department = 'client_relations' order by key, variant`);
}
