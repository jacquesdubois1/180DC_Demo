-- ============================================================================
-- VIEWS for lists and dashboards. security_invoker = true: the caller's RLS
-- applies, so a view can never leak rows its reader could not query directly.
-- ============================================================================

CREATE VIEW public.v_applications WITH (security_invoker = true) AS
SELECT a.id, a.cycle_id, c.name AS cycle_name, a.position_id, p.name AS position_name, p.slug AS position_slug,
       a.stage, a.alias, a.person_id,
       pe.first_name, pe.last_name, pe.email, pe.phone, pe.linkedin_url, pe.nationality,
       a.university, a.degree_program, a.study_year, a.languages, a.heard_from,
       a.cv_file_id, a.extracted IS NOT NULL AS has_extraction,
       a.submitted_at, a.stage_changed_at, a.decided_at, a.decision_reason, a.anonymized_at,
       (current_date - a.stage_changed_at::date) AS days_in_stage,
       (SELECT count(*)::int FROM public.application_reviewers ar WHERE ar.application_id = a.id
          AND ar.stage = CASE WHEN a.stage IN ('received', 'screening') THEN 'screening'::public.review_stage
                              ELSE 'interview'::public.review_stage END) AS reviewers_assigned,
       (SELECT count(*)::int FROM public.reviews r WHERE r.application_id = a.id AND r.submitted_at IS NOT NULL
          AND r.stage = CASE WHEN a.stage IN ('received', 'screening') THEN 'screening'::public.review_stage
                             ELSE 'interview'::public.review_stage END) AS reviews_submitted,
       (SELECT round(avg(v.value::numeric), 2) FROM public.reviews r, jsonb_each_text(r.scores) v
          WHERE r.application_id = a.id AND r.submitted_at IS NOT NULL) AS avg_score,
       (SELECT count(*)::int FROM public.reviews r WHERE r.application_id = a.id AND r.submitted_at IS NOT NULL
          AND r.recommendation IN ('strong_yes', 'yes')) AS yes_votes,
       (SELECT count(*)::int FROM public.reviews r WHERE r.application_id = a.id AND r.submitted_at IS NOT NULL
          AND r.recommendation = 'maybe') AS maybe_votes,
       (SELECT count(*)::int FROM public.reviews r WHERE r.application_id = a.id AND r.submitted_at IS NOT NULL
          AND r.recommendation = 'no') AS no_votes
FROM public.applications a
JOIN public.recruitment_cycles c ON c.id = a.cycle_id
JOIN public.positions p ON p.id = a.position_id
LEFT JOIN public.people pe ON pe.id = a.person_id;

-- Funnel: how many applications reached at least each stage (from the history)
CREATE VIEW public.v_hr_funnel WITH (security_invoker = true) AS
WITH reached AS (
  SELECT a.cycle_id, a.position_id, a.id,
         bool_or(true) AS received,
         bool_or(h.to_status IN ('screening', 'interview', 'final_review', 'offer_sent', 'offer_accepted', 'offer_declined', 'waitlisted')
                 OR a.stage IN ('screening', 'interview', 'final_review', 'offer_sent', 'offer_accepted', 'offer_declined', 'waitlisted')) AS screened,
         bool_or(h.to_status IN ('interview', 'final_review', 'offer_sent', 'offer_accepted', 'offer_declined')
                 OR a.stage IN ('interview', 'final_review', 'offer_sent', 'offer_accepted', 'offer_declined')) AS interviewed,
         bool_or(h.to_status IN ('offer_sent', 'offer_accepted', 'offer_declined')
                 OR a.stage IN ('offer_sent', 'offer_accepted', 'offer_declined')) AS offered,
         bool_or(a.stage = 'offer_accepted') AS accepted
  FROM public.applications a
  LEFT JOIN public.status_history h ON h.entity = 'application' AND h.entity_id = a.id
  GROUP BY a.cycle_id, a.position_id, a.id
)
SELECT cycle_id, position_id,
       count(*) FILTER (WHERE received)::int AS received,
       count(*) FILTER (WHERE screened)::int AS screened,
       count(*) FILTER (WHERE interviewed)::int AS interviewed,
       count(*) FILTER (WHERE offered)::int AS offered,
       count(*) FILTER (WHERE accepted)::int AS accepted
FROM reached GROUP BY cycle_id, position_id;

CREATE VIEW public.v_leads WITH (security_invoker = true) AS
SELECT l.id, l.organization_id, o.name AS organization_name, o.type AS organization_type, o.sector, o.city,
       o.size_band, o.website, o.domain, o.do_not_contact AS organization_do_not_contact, o.impact_areas,
       l.owner_id, u.display_name AS owner_name, l.stage, l.source, l.priority, l.project_idea,
       l.next_step, l.next_step_due, l.lost_reason, l.stage_changed_at, l.created_at,
       coalesce(l.last_activity_at, l.created_at) AS last_activity_at,
       (current_date - coalesce(l.last_activity_at, l.created_at)::date) AS days_since_activity,
       (l.next_step_due IS NOT NULL AND l.next_step_due < current_date
          AND l.stage NOT IN ('won', 'lost', 'not_interested')) AS is_overdue,
       pc.person_id AS primary_contact_id,
       pe.first_name || ' ' || pe.last_name AS primary_contact_name,
       pe.email AS primary_contact_email,
       pr.title AS primary_contact_title,
       coalesce(pr.is_esade_alumni, false) AS primary_contact_is_alumni,
       s.fit_score, s.reply_probability, s.win_probability
FROM public.leads l
JOIN public.organizations o ON o.id = l.organization_id
LEFT JOIN public.app_users u ON u.id = l.owner_id
LEFT JOIN public.lead_contacts pc ON pc.lead_id = l.id AND pc.is_primary
LEFT JOIN public.people pe ON pe.id = pc.person_id
LEFT JOIN public.person_roles pr ON pr.person_id = pc.person_id AND pr.organization_id = l.organization_id
                                 AND pr.role = 'contact' AND pr.end_date IS NULL
LEFT JOIN public.lead_scores s ON s.lead_id = l.id;

-- Outreach e-mail performance per template variant: sent, replied (reply after the e-mail)
CREATE VIEW public.v_template_performance WITH (security_invoker = true) AS
SELECT t.id AS template_id, t.key, t.variant, t.name,
       count(o.id) FILTER (WHERE o.status = 'sent')::int AS sent,
       count(DISTINCT o.lead_id) FILTER (
         WHERE o.status = 'sent' AND EXISTS (
           SELECT 1 FROM public.interactions i
           WHERE i.lead_id = o.lead_id AND i.type = 'email_in' AND i.occurred_at > o.sent_at))::int AS replied
FROM public.email_templates t
LEFT JOIN public.email_outbox o ON o.template_id = t.id
WHERE t.department = 'client_relations'
GROUP BY t.id, t.key, t.variant, t.name;

REVOKE ALL ON public.v_applications, public.v_hr_funnel, public.v_leads, public.v_template_performance FROM anon;
GRANT SELECT ON public.v_applications, public.v_hr_funnel, public.v_leads, public.v_template_performance
  TO authenticated, service_role;
