-- ============================================================================
-- FUNCTIONS: role checks used by every access rule, transactional stage changes
-- with history, the blind-review interface, audit logging, retention.
-- Role checks are SECURITY DEFINER so policies can call them without recursion;
-- they only ever look at the CURRENT user (auth.uid()), never at arguments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who is calling?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND is_active)
$$;

CREATE OR REPLACE FUNCTION app.has_any_role(VARIADIC roles public.app_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.app_users u ON u.id = ur.user_id
    WHERE ur.user_id = auth.uid() AND u.is_active AND (ur.role = ANY (roles) OR ur.role = 'admin'))
$$;

CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.app_users u ON u.id = ur.user_id
    WHERE ur.user_id = auth.uid() AND u.is_active AND ur.role = 'admin')
$$;

-- Server-side jobs (cron, public form) run with the service role claim
CREATE OR REPLACE FUNCTION app.is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT auth.role() = 'service_role' $$;

CREATE OR REPLACE FUNCTION app.is_hr() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.has_any_role('hr') $$;

CREATE OR REPLACE FUNCTION app.is_outreach() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.has_any_role('client_relations') $$;

CREATE OR REPLACE FUNCTION app.current_person_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT person_id FROM public.app_users WHERE id = auth.uid() AND is_active
$$;

CREATE OR REPLACE FUNCTION app.is_contact(p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.person_roles WHERE person_id = p_person_id AND role = 'contact')
$$;

CREATE OR REPLACE FUNCTION app.is_assigned_reviewer(p_application_id uuid, p_stage public.review_stage DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.application_reviewers ar
    WHERE ar.application_id = p_application_id AND ar.reviewer_id = auth.uid()
      AND (p_stage IS NULL OR ar.stage = p_stage))
  AND app.is_member()
$$;

CREATE OR REPLACE FUNCTION app.has_submitted_review(p_application_id uuid, p_stage public.review_stage)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE application_id = p_application_id AND stage = p_stage
      AND reviewer_id = auth.uid() AND submitted_at IS NOT NULL)
$$;

-- Blind screening hides identity from reviewers until the interview stage
CREATE OR REPLACE FUNCTION app.is_blind_for_me(p_application_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT app.is_hr() AND coalesce((
    SELECT c.blind_screening AND NOT EXISTS (
             SELECT 1 FROM public.application_reviewers ar
             WHERE ar.application_id = a.id AND ar.reviewer_id = auth.uid() AND ar.stage = 'interview')
    FROM public.applications a JOIN public.recruitment_cycles c ON c.id = a.cycle_id
    WHERE a.id = p_application_id), true)
$$;

CREATE OR REPLACE FUNCTION app.can_access_file(p_file_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_hr()
      OR EXISTS (SELECT 1 FROM public.files f WHERE f.id = p_file_id AND f.created_by = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.cv_file_id = p_file_id
          AND app.is_assigned_reviewer(a.id)
          AND NOT app.is_blind_for_me(a.id))
$$;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.log_event(p_action text, p_entity text, p_entity_id uuid, p_details jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Application stage machine: one function for board, dropdown and decision
-- buttons. Checks the role, validates the transition, updates the row and writes
-- the history in ONE transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.application_transition_allowed(p_from public.application_stage, p_to public.application_stage)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_from <> p_to AND CASE p_from
    WHEN 'received'       THEN p_to IN ('screening', 'rejected', 'withdrawn')
    WHEN 'screening'      THEN p_to IN ('received', 'interview', 'waitlisted', 'rejected', 'withdrawn')
    WHEN 'interview'      THEN p_to IN ('screening', 'final_review', 'waitlisted', 'rejected', 'withdrawn')
    WHEN 'final_review'   THEN p_to IN ('interview', 'offer_sent', 'waitlisted', 'rejected', 'withdrawn')
    WHEN 'waitlisted'     THEN p_to IN ('final_review', 'offer_sent', 'rejected', 'withdrawn')
    WHEN 'offer_sent'     THEN p_to IN ('offer_accepted', 'offer_declined', 'withdrawn')
    WHEN 'rejected'       THEN p_to IN ('screening', 'interview', 'final_review')   -- correcting a mistake
    WHEN 'withdrawn'      THEN p_to IN ('screening')
    WHEN 'offer_declined' THEN p_to IN ('waitlisted')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION app.move_application(p_application_id uuid, p_to public.application_stage, p_note text DEFAULT NULL)
RETURNS public.applications LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.applications;
  v_from public.application_stage;
BEGIN
  IF NOT app.is_hr() THEN
    RAISE EXCEPTION 'Only HR can change the stage of an application' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application % not found', p_application_id USING ERRCODE = 'P0002';
  END IF;
  IF v_app.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Application has been anonymised' USING ERRCODE = '22023';
  END IF;
  v_from := v_app.stage;
  IF NOT app.application_transition_allowed(v_from, p_to) THEN
    RAISE EXCEPTION 'Stage change % -> % is not allowed', v_from, p_to USING ERRCODE = '22023';
  END IF;
  IF p_to IN ('rejected', 'waitlisted', 'offer_sent') AND nullif(trim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for the decision %', p_to USING ERRCODE = '22023';
  END IF;

  UPDATE public.applications SET
    stage = p_to,
    stage_changed_at = now(),
    decision_reason = CASE WHEN p_to IN ('rejected', 'waitlisted', 'offer_sent') THEN p_note ELSE decision_reason END,
    decided_at = CASE WHEN p_to IN ('rejected', 'waitlisted', 'offer_sent') THEN now() ELSE decided_at END,
    decided_by = CASE WHEN p_to IN ('rejected', 'waitlisted', 'offer_sent') THEN auth.uid() ELSE decided_by END,
    offer_sent_at = CASE WHEN p_to = 'offer_sent' THEN now() ELSE offer_sent_at END,
    offer_responded_at = CASE WHEN p_to IN ('offer_accepted', 'offer_declined') THEN now() ELSE offer_responded_at END
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  INSERT INTO public.status_history (entity, entity_id, from_status, to_status, note, changed_by)
  VALUES ('application', p_application_id, v_from::text, p_to::text, p_note, auth.uid());

  -- an accepted offer turns the applicant into a member (life role history)
  IF p_to = 'offer_accepted' AND v_app.person_id IS NOT NULL THEN
    INSERT INTO public.person_roles (person_id, role, department, start_date, created_by)
    SELECT v_app.person_id, 'member', p.department, current_date, auth.uid()
    FROM public.positions p WHERE p.id = v_app.position_id
    AND NOT EXISTS (SELECT 1 FROM public.person_roles pr
                    WHERE pr.person_id = v_app.person_id AND pr.role = 'member' AND pr.end_date IS NULL);
  END IF;
  RETURN v_app;
END $$;

-- ---------------------------------------------------------------------------
-- Lead stage machine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.move_lead(p_lead_id uuid, p_to public.lead_stage, p_note text DEFAULT NULL)
RETURNS public.leads LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lead public.leads;
  v_from public.lead_stage;
BEGIN
  IF NOT app.is_outreach() THEN
    RAISE EXCEPTION 'Only Client Relations can change a lead' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found', p_lead_id USING ERRCODE = 'P0002';
  END IF;
  v_from := v_lead.stage;
  IF v_from = p_to THEN
    RETURN v_lead;
  END IF;
  IF p_to IN ('lost', 'not_interested') AND nullif(trim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when a lead is closed as %', p_to USING ERRCODE = '22023';
  END IF;
  UPDATE public.leads SET
    stage = p_to,
    stage_changed_at = now(),
    lost_reason = CASE WHEN p_to IN ('lost', 'not_interested') THEN p_note ELSE lost_reason END
  WHERE id = p_lead_id RETURNING * INTO v_lead;
  INSERT INTO public.status_history (entity, entity_id, from_status, to_status, note, changed_by)
  VALUES ('lead', p_lead_id, v_from::text, p_to::text, p_note, auth.uid());
  -- replies / closing stop any running follow-up sequence
  IF p_to IN ('replied', 'meeting', 'proposal', 'won', 'lost', 'not_interested', 'on_hold') THEN
    UPDATE public.sequence_enrollments SET status = 'stopped', stop_reason = 'lead moved to ' || p_to
    WHERE lead_id = p_lead_id AND status = 'active';
  END IF;
  RETURN v_lead;
END $$;

-- ---------------------------------------------------------------------------
-- Blind review interface: what a reviewer may see about THEIR assignments.
-- Reviewers have no direct access to applications/people; this is the only door.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.my_review_assignments()
RETURNS TABLE (
  application_id uuid, alias text, cycle_name text, position_name text, review_stage public.review_stage,
  application_stage public.application_stage, due_at timestamptz, is_blind boolean,
  candidate_name text, degree_program text, study_year text, university text, languages text[],
  answers jsonb, questions jsonb, cv_file_id uuid, rubric_id uuid,
  my_review_id uuid, my_submitted_at timestamptz, reviews_submitted integer, reviewers_assigned integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.alias, c.name, p.name, ar.stage, a.stage, ar.due_at,
         (c.blind_screening AND ar.stage = 'screening') AS is_blind,
         CASE WHEN c.blind_screening AND ar.stage = 'screening' THEN NULL
              ELSE pe.first_name || ' ' || pe.last_name END,
         a.degree_program, a.study_year,
         CASE WHEN c.blind_screening AND ar.stage = 'screening' THEN NULL ELSE a.university END,
         a.languages, a.answers, p.questions,
         CASE WHEN c.blind_screening AND ar.stage = 'screening' THEN NULL ELSE a.cv_file_id END,
         CASE ar.stage WHEN 'screening' THEN p.screening_rubric_id ELSE p.interview_rubric_id END,
         r.id, r.submitted_at,
         (SELECT count(*)::int FROM public.reviews r2 WHERE r2.application_id = a.id AND r2.stage = ar.stage
            AND r2.submitted_at IS NOT NULL),
         (SELECT count(*)::int FROM public.application_reviewers ar2 WHERE ar2.application_id = a.id
            AND ar2.stage = ar.stage)
  FROM public.application_reviewers ar
  JOIN public.applications a ON a.id = ar.application_id
  JOIN public.recruitment_cycles c ON c.id = a.cycle_id
  JOIN public.positions p ON p.id = a.position_id
  LEFT JOIN public.people pe ON pe.id = a.person_id
  LEFT JOIN public.reviews r ON r.application_id = a.id AND r.reviewer_id = ar.reviewer_id AND r.stage = ar.stage
  WHERE ar.reviewer_id = auth.uid() AND app.is_member() AND a.anonymized_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- Retention (GDPR storage limitation): anonymise closed applications after the
-- cycle's retention period. Keeps non-identifying facts (track, stages, dates,
-- scores) so funnel statistics survive; removes the person, answers, CV, notes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.retention_candidates()
RETURNS TABLE (application_id uuid, cv_file_id uuid, cycle_name text, closed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.cv_file_id, c.name, coalesce(a.decided_at, a.stage_changed_at)
  FROM public.applications a JOIN public.recruitment_cycles c ON c.id = a.cycle_id
  WHERE a.anonymized_at IS NULL
    AND a.stage IN ('rejected', 'withdrawn', 'offer_declined')
    AND coalesce(a.decided_at, a.stage_changed_at) < now() - make_interval(days => c.retention_days)
    AND (app.is_admin() OR app.is_service())
$$;

CREATE OR REPLACE FUNCTION app.anonymize_application(p_application_id uuid, p_reason text DEFAULT 'retention')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_person uuid;
BEGIN
  IF NOT (app.is_admin() OR app.is_hr() OR app.is_service()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT person_id INTO v_person FROM public.applications WHERE id = p_application_id FOR UPDATE;
  DELETE FROM public.files WHERE id = (SELECT cv_file_id FROM public.applications WHERE id = p_application_id);
  DELETE FROM public.application_comments WHERE application_id = p_application_id;
  UPDATE public.reviews SET comment = NULL WHERE application_id = p_application_id;
  UPDATE public.applications SET
    person_id = NULL, answers = '{}'::jsonb, extracted = NULL, extracted_at = NULL, university = NULL,
    languages = '{}', cv_file_id = NULL, decision_reason = NULL, anonymized_at = now()
  WHERE id = p_application_id;
  -- delete the person entirely if nothing else links to them
  IF v_person IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.applications WHERE person_id = v_person)
     AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE person_id = v_person)
     AND NOT EXISTS (SELECT 1 FROM public.person_roles WHERE person_id = v_person AND role <> 'applicant') THEN
    DELETE FROM public.people WHERE id = v_person;
  END IF;
  PERFORM app.log_event('application.anonymized', 'application', p_application_id, jsonb_build_object('reason', p_reason));
END $$;

-- Right to erasure for a contact or applicant: anonymise everything and suppress the address
CREATE OR REPLACE FUNCTION app.erase_person(p_person_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email extensions.citext;
  v_app uuid;
BEGIN
  IF NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only admins can erase a person' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE person_id = p_person_id) THEN
    RAISE EXCEPTION 'Deactivate the user account before erasing the person' USING ERRCODE = '22023';
  END IF;
  SELECT email INTO v_email FROM public.people WHERE id = p_person_id;
  FOR v_app IN SELECT id FROM public.applications WHERE person_id = p_person_id LOOP
    PERFORM app.anonymize_application(v_app, 'erasure_request');
  END LOOP;
  UPDATE public.interactions SET summary = '[removed on request]', person_id = NULL WHERE person_id = p_person_id;
  UPDATE public.email_outbox SET body_text = '[removed on request]', to_person_id = NULL WHERE to_person_id = p_person_id;
  DELETE FROM public.people WHERE id = p_person_id;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.email_suppressions (email, reason, source) VALUES (v_email, 'gdpr_erasure', 'erasure request')
    ON CONFLICT DO NOTHING;
  END IF;
  PERFORM app.log_event('person.erased', 'person', p_person_id, '{}'::jsonb);
END $$;

-- Is an address allowed to receive e-mail from us?
CREATE OR REPLACE FUNCTION app.is_suppressed(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.email_suppressions s
                 WHERE s.email = p_email::extensions.citext
                    OR s.domain = split_part(p_email, '@', 2)::extensions.citext)
      OR EXISTS (SELECT 1 FROM public.people p WHERE p.email = p_email::extensions.citext AND p.do_not_contact)
      OR EXISTS (SELECT 1 FROM public.person_roles pr JOIN public.organizations o ON o.id = pr.organization_id
                 JOIN public.people p ON p.id = pr.person_id
                 WHERE p.email = p_email::extensions.citext AND o.do_not_contact)
$$;
