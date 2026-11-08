-- ============================================================================
-- CLIENT OUTREACH: leads (one open lead per organisation), contacts at leads,
-- interactions, ideal-customer profiles, lead scores, prospect imports with
-- de-duplication review, AI lead suggestions.
-- ============================================================================

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  stage public.lead_stage NOT NULL DEFAULT 'new',
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import', 'ai_research', 'referral', 'inbound', 'alumni', 'event')),
  priority integer NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  project_idea text,
  next_step text,
  next_step_due date,
  lost_reason text,
  handed_over_to text,       -- consulting director who takes over after signature
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_lost_reason CHECK (stage NOT IN ('lost', 'not_interested') OR lost_reason IS NOT NULL)
);
-- at most one OPEN lead per organisation (history of closed leads is kept)
CREATE UNIQUE INDEX leads_one_open_per_org ON public.leads (organization_id)
  WHERE stage NOT IN ('won', 'lost', 'not_interested');
CREATE INDEX leads_owner_due ON public.leads (owner_id, next_step_due);
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE public.lead_contacts (
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (lead_id, person_id)
);
CREATE UNIQUE INDEX lead_contacts_one_primary ON public.lead_contacts (lead_id) WHERE is_primary;

CREATE TABLE public.interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  type public.interaction_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  subject text,
  summary text,
  email_outbox_id uuid,               -- set for e-mails sent through the Hub
  template_id uuid,
  template_variant text,
  external_thread_id text,            -- Gmail thread id once Gmail sync is on
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT interactions_target CHECK (organization_id IS NOT NULL OR person_id IS NOT NULL)
);
CREATE INDEX interactions_lead ON public.interactions (lead_id, occurred_at DESC);
CREATE INDEX interactions_org ON public.interactions (organization_id, occurred_at DESC);

-- keep leads.last_activity_at in sync for "stale lead" alerts
CREATE OR REPLACE FUNCTION app.touch_lead_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads SET last_activity_at = greatest(coalesce(last_activity_at, NEW.occurred_at), NEW.occurred_at)
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interactions_touch_lead AFTER INSERT ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION app.touch_lead_activity();

-- Ideal customer profile: weighted criteria used for transparent fit scoring
CREATE TABLE public.icp_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  criteria jsonb NOT NULL,     -- see lib/outreach/scoring.ts for the schema
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.lead_scores (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  fit_score numeric NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  reply_probability numeric CHECK (reply_probability BETWEEN 0 AND 1),
  win_probability numeric CHECK (win_probability BETWEEN 0 AND 1),
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Prospect imports (Excel / CSV / monday.com export) with a de-duplication review step
CREATE TABLE public.prospect_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'committed', 'discarded')),
  column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  committed_at timestamptz
);

CREATE TABLE public.prospect_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.prospect_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  normalized jsonb NOT NULL,
  match_status text NOT NULL CHECK (match_status IN ('new', 'duplicate', 'possible_duplicate', 'in_file_duplicate', 'invalid')),
  matched_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  matched_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  similarity numeric,
  match_reason text,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'create', 'merge', 'skip')),
  UNIQUE (import_id, row_number)
);

-- AI-assisted lead research: suggestions are only added after a human accepts them
CREATE TABLE public.lead_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid,
  name text NOT NULL,
  website text,
  domain extensions.citext,
  org_type public.org_type,
  sector text,
  city text,
  rationale text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_contact_role text,
  fit_score numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'duplicate')),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz
);
