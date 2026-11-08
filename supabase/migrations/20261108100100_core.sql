-- ============================================================================
-- CORE: one row per human (people), organisations, life roles, logins & access,
-- files, history and the audit trail.
-- Core rule: every person exists exactly once in `people` (e-mail is the key).
-- ============================================================================

CREATE TABLE public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  email extensions.citext UNIQUE,
  phone text,
  linkedin_url text,
  nationality text,
  city text,
  do_not_contact boolean NOT NULL DEFAULT false,
  do_not_contact_at timestamptz,
  notes text,
  search_text text GENERATED ALWAYS AS (app.fold(first_name || ' ' || last_name || ' ' || coalesce(email::text, ''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_email_format CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE INDEX people_search_trgm ON public.people USING gin (search_text extensions.gin_trgm_ops);
CREATE TRIGGER people_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (app.normalize_org_name(name)) STORED,
  type public.org_type NOT NULL DEFAULT 'company',
  website text,
  domain extensions.citext,
  sector text,
  size_band text CHECK (size_band IS NULL OR size_band IN ('1-10', '11-50', '51-200', '201-1000', '1000+')),
  city text,
  country text DEFAULT 'Spain',
  description text,
  impact_areas text[] NOT NULL DEFAULT '{}',
  linkedin_url text,
  do_not_contact boolean NOT NULL DEFAULT false,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_domain_unique ON public.organizations (domain) WHERE domain IS NOT NULL;
CREATE INDEX organizations_name_trgm ON public.organizations USING gin (normalized_name extensions.gin_trgm_ops);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- derive the domain from the website when it is not given explicitly
CREATE OR REPLACE FUNCTION app.organizations_fill_domain() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.domain IS NULL AND NEW.website IS NOT NULL THEN
    NEW.domain := app.extract_domain(NEW.website);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizations_fill_domain BEFORE INSERT OR UPDATE OF website, domain ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app.organizations_fill_domain();

-- Who was what, and when (applicant -> member -> alumni; contact at an organisation)
CREATE TABLE public.person_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  role public.life_role NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text,
  department public.department,
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  is_esade_alumni boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT person_roles_contact_needs_org CHECK (role <> 'contact' OR organization_id IS NOT NULL)
);
CREATE INDEX person_roles_person ON public.person_roles (person_id);
CREATE INDEX person_roles_org ON public.person_roles (organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX person_roles_one_open_contact ON public.person_roles (person_id, organization_id)
  WHERE role = 'contact' AND end_date IS NULL;

-- People who can sign in. id = the Supabase Auth user id (or a demo user id).
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY,
  person_id uuid UNIQUE REFERENCES public.people(id) ON DELETE SET NULL,
  email extensions.citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  department public.department NOT NULL DEFAULT 'other',
  title text,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Access roles drive the row-level security; separate from life roles above
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid REFERENCES public.app_users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Uploaded files (CVs, import sheets). Content lives in Supabase Storage in production,
-- or in file_blobs / on disk in demo & local environments.
CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  path text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  sha256 text,
  storage_backend text NOT NULL DEFAULT 'database' CHECK (storage_backend IN ('database', 'disk', 'supabase')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (bucket, path)
);

CREATE TABLE public.file_blobs (
  file_id uuid PRIMARY KEY REFERENCES public.files(id) ON DELETE CASCADE,
  content bytea NOT NULL
);

-- Every stage change of applications and leads (who, when, from, to, why)
CREATE TABLE public.status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('application', 'lead')),
  entity_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_history_entity ON public.status_history (entity, entity_id, changed_at);

-- Accountability log for sensitive actions (GDPR art. 5(2)): CV views, exports, deletions,
-- role changes, decisions. Written only through app.log_event().
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at ON public.audit_log (at DESC);
CREATE INDEX audit_log_entity ON public.audit_log (entity, entity_id);
