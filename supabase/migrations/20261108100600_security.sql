-- ============================================================================
-- SECURITY: privileges + row-level security for EVERY table.
-- Principle: access is enforced in the database, not only hidden in the UI.
-- A table with RLS on and no matching policy returns nothing (safe default).
--
--   role               sees / changes
--   admin              everything (incl. audit log, user roles, erasure)
--   hr                 recruitment data, applicants, HR templates & e-mails
--   interviewer        ONLY assigned applications, through app.my_review_assignments()
--   client_relations   organisations, contacts, leads, interactions, outreach e-mails
--   member             own profile, colleague directory, organisation names
-- ============================================================================

-- created_by is filled from the session automatically
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'created_by'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by SET DEFAULT auth.uid()', r.table_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Privileges: the browser never talks to the database, but defence in depth:
-- anon gets nothing at all, authenticated gets table privileges filtered by RLS.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM anon, public;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
-- the audit log and history are append-only and written by functions only
REVOKE INSERT, UPDATE, DELETE ON public.audit_log, public.status_history FROM authenticated;
REVOKE ALL ON public.file_blobs FROM authenticated;

-- ---------------------------------------------------------------------------
-- Turn RLS on everywhere
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Core
-- ---------------------------------------------------------------------------
CREATE POLICY settings_read ON public.settings FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY settings_admin ON public.settings FOR ALL TO authenticated USING (app.is_admin()) WITH CHECK (app.is_admin());

CREATE POLICY people_read ON public.people FOR SELECT TO authenticated USING (
  app.is_hr()
  OR (app.is_outreach() AND app.is_contact(id))
  OR id = app.current_person_id()
  OR (created_by = auth.uid() AND app.is_member()));
CREATE POLICY people_insert ON public.people FOR INSERT TO authenticated
  WITH CHECK (app.is_hr() OR app.is_outreach());
CREATE POLICY people_update ON public.people FOR UPDATE TO authenticated
  USING (app.is_hr() OR (app.is_outreach() AND (app.is_contact(id) OR created_by = auth.uid())) OR id = app.current_person_id())
  WITH CHECK (app.is_hr() OR app.is_outreach() OR id = app.current_person_id());
CREATE POLICY people_delete ON public.people FOR DELETE TO authenticated USING (app.is_admin());

CREATE POLICY organizations_read ON public.organizations FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY organizations_write ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (app.is_outreach());
CREATE POLICY organizations_update ON public.organizations FOR UPDATE TO authenticated
  USING (app.is_outreach()) WITH CHECK (app.is_outreach());
CREATE POLICY organizations_delete ON public.organizations FOR DELETE TO authenticated USING (app.is_admin());

CREATE POLICY person_roles_read ON public.person_roles FOR SELECT TO authenticated USING (
  app.is_hr() OR (app.is_outreach() AND role = 'contact') OR person_id = app.current_person_id());
CREATE POLICY person_roles_write ON public.person_roles FOR ALL TO authenticated
  USING ((app.is_hr() AND role <> 'contact') OR (app.is_outreach() AND role = 'contact'))
  WITH CHECK ((app.is_hr() AND role <> 'contact') OR (app.is_outreach() AND role = 'contact'));

CREATE POLICY app_users_read ON public.app_users FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY app_users_admin ON public.app_users FOR ALL TO authenticated
  USING (app.is_admin()) WITH CHECK (app.is_admin());

CREATE POLICY user_roles_read ON public.user_roles FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY user_roles_admin ON public.user_roles FOR ALL TO authenticated
  USING (app.is_admin()) WITH CHECK (app.is_admin());

CREATE POLICY files_read ON public.files FOR SELECT TO authenticated USING (app.can_access_file(id));
CREATE POLICY files_insert ON public.files FOR INSERT TO authenticated WITH CHECK (app.is_member());
CREATE POLICY files_delete ON public.files FOR DELETE TO authenticated USING (app.is_hr() OR created_by = auth.uid());

CREATE POLICY status_history_read ON public.status_history FOR SELECT TO authenticated USING (
  (entity = 'application' AND app.is_hr()) OR (entity = 'lead' AND app.is_outreach()));

CREATE POLICY audit_log_read ON public.audit_log FOR SELECT TO authenticated USING (app.is_admin());

-- ---------------------------------------------------------------------------
-- HR
-- ---------------------------------------------------------------------------
CREATE POLICY cycles_read ON public.recruitment_cycles FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY cycles_write ON public.recruitment_cycles FOR ALL TO authenticated
  USING (app.is_hr()) WITH CHECK (app.is_hr());
CREATE POLICY positions_read ON public.positions FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY positions_write ON public.positions FOR ALL TO authenticated USING (app.is_hr()) WITH CHECK (app.is_hr());
CREATE POLICY rubrics_read ON public.rubrics FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY rubrics_write ON public.rubrics FOR ALL TO authenticated USING (app.is_hr()) WITH CHECK (app.is_hr());
CREATE POLICY rubric_criteria_read ON public.rubric_criteria FOR SELECT TO authenticated USING (app.is_member());
CREATE POLICY rubric_criteria_write ON public.rubric_criteria FOR ALL TO authenticated
  USING (app.is_hr()) WITH CHECK (app.is_hr());

-- interviewers have NO direct access to applications (blind review goes through a function)
CREATE POLICY applications_hr ON public.applications FOR ALL TO authenticated
  USING (app.is_hr()) WITH CHECK (app.is_hr());

CREATE POLICY application_reviewers_read ON public.application_reviewers FOR SELECT TO authenticated
  USING (app.is_hr() OR reviewer_id = auth.uid());
CREATE POLICY application_reviewers_write ON public.application_reviewers FOR ALL TO authenticated
  USING (app.is_hr()) WITH CHECK (app.is_hr());

CREATE POLICY reviewer_pool_read ON public.reviewer_pool FOR SELECT TO authenticated
  USING (app.is_hr() OR user_id = auth.uid());
CREATE POLICY reviewer_pool_write ON public.reviewer_pool FOR ALL TO authenticated
  USING (app.is_hr()) WITH CHECK (app.is_hr());

CREATE POLICY review_conflicts_read ON public.review_conflicts FOR SELECT TO authenticated
  USING (app.is_hr() OR reviewer_id = auth.uid());
CREATE POLICY review_conflicts_insert ON public.review_conflicts FOR INSERT TO authenticated
  WITH CHECK (app.is_hr() OR (reviewer_id = auth.uid() AND app.is_member()));
CREATE POLICY review_conflicts_delete ON public.review_conflicts FOR DELETE TO authenticated USING (app.is_hr());

-- blind until your own review is in: you see other scores only after submitting yours
CREATE POLICY reviews_read ON public.reviews FOR SELECT TO authenticated USING (
  app.is_hr()
  OR reviewer_id = auth.uid()
  OR (app.is_assigned_reviewer(application_id, stage) AND app.has_submitted_review(application_id, stage)));
CREATE POLICY reviews_insert ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid() AND app.is_assigned_reviewer(application_id, stage));
CREATE POLICY reviews_update ON public.reviews FOR UPDATE TO authenticated
  USING (reviewer_id = auth.uid() AND app.is_assigned_reviewer(application_id, stage))
  WITH CHECK (reviewer_id = auth.uid());
CREATE POLICY reviews_delete ON public.reviews FOR DELETE TO authenticated USING (app.is_hr());

CREATE POLICY comments_read ON public.application_comments FOR SELECT TO authenticated USING (
  app.is_hr()
  OR (visibility = 'reviewers' AND app.is_assigned_reviewer(application_id) AND NOT app.is_blind_for_me(application_id)));
CREATE POLICY comments_insert ON public.application_comments FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid()
  AND (app.is_hr() OR (visibility = 'reviewers' AND app.is_assigned_reviewer(application_id)
                       AND NOT app.is_blind_for_me(application_id))));
CREATE POLICY comments_delete ON public.application_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR app.is_admin());

CREATE POLICY interviews_read ON public.interviews FOR SELECT TO authenticated
  USING (app.is_hr() OR auth.uid() = ANY (interviewer_ids));
CREATE POLICY interviews_write ON public.interviews FOR ALL TO authenticated USING (app.is_hr()) WITH CHECK (app.is_hr());

-- ---------------------------------------------------------------------------
-- Client outreach: Client Relations (and admins) only
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'lead_contacts', 'interactions', 'icp_profiles', 'lead_scores',
                           'prospect_imports', 'prospect_import_rows', 'lead_suggestions',
                           'email_sequences', 'sequence_enrollments'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (app.is_outreach()) WITH CHECK (app.is_outreach())',
                   t || '_outreach', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- E-mail: each department sees its own templates and messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.can_use_department(p_department public.department) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin()
      OR (p_department = 'hr' AND app.is_hr())
      OR (p_department = 'client_relations' AND app.is_outreach())
$$;
GRANT EXECUTE ON FUNCTION app.can_use_department(public.department) TO authenticated, service_role;

CREATE POLICY email_templates_dept ON public.email_templates FOR ALL TO authenticated
  USING (app.can_use_department(department)) WITH CHECK (app.can_use_department(department));
CREATE POLICY email_outbox_dept ON public.email_outbox FOR ALL TO authenticated
  USING (app.can_use_department(department) OR from_user_id = auth.uid())
  WITH CHECK (app.can_use_department(department));
CREATE POLICY email_suppressions_read ON public.email_suppressions FOR SELECT TO authenticated
  USING (app.is_hr() OR app.is_outreach());
CREATE POLICY email_suppressions_insert ON public.email_suppressions FOR INSERT TO authenticated
  WITH CHECK (app.is_hr() OR app.is_outreach());
CREATE POLICY email_suppressions_delete ON public.email_suppressions FOR DELETE TO authenticated USING (app.is_admin());

CREATE POLICY ai_runs_read ON public.ai_runs FOR SELECT TO authenticated USING (
  created_by = auth.uid() OR app.is_admin()
  OR (kind = 'cv_extraction' AND app.is_hr())
  OR (kind IN ('lead_research', 'email_draft', 'reply_classification') AND app.is_outreach()));
CREATE POLICY ai_runs_insert ON public.ai_runs FOR INSERT TO authenticated WITH CHECK (app.is_member());
CREATE POLICY ai_runs_update ON public.ai_runs FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
