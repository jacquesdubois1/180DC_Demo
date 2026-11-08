-- ============================================================================
-- HR: recruitment cycles, positions (tracks), rubrics, applications, reviewer
-- assignments, blind scorecards, comments, interviews, conflicts of interest.
-- ============================================================================

CREATE TABLE public.recruitment_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  status public.cycle_status NOT NULL DEFAULT 'draft',
  opens_at timestamptz,
  closes_at timestamptz,
  -- GDPR: rejected / withdrawn applications are anonymised after this many days
  retention_days integer NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 30 AND 1095),
  blind_screening boolean NOT NULL DEFAULT true,
  reviewers_per_application integer NOT NULL DEFAULT 2 CHECK (reviewers_per_application BETWEEN 1 AND 5),
  privacy_notice_version text NOT NULL DEFAULT '2026-11',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT cycle_dates CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)
);

CREATE TABLE public.rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  stage public.review_stage NOT NULL,
  scale_min integer NOT NULL DEFAULT 1,
  scale_max integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scale_max > scale_min)
);

CREATE TABLE public.rubric_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id uuid NOT NULL REFERENCES public.rubrics(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z_]+$'),
  label text NOT NULL,
  description text,
  anchors jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"1": "no evidence", "3": "...", "5": "..."}
  weight numeric NOT NULL DEFAULT 1 CHECK (weight > 0),
  position integer NOT NULL DEFAULT 0,
  UNIQUE (rubric_id, key)
);

-- Recruitment tracks per cycle (Impact Consultants, Analytics, Associates, Board, ...)
CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.recruitment_cycles(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  department public.department NOT NULL DEFAULT 'consulting',
  description text,
  places integer CHECK (places IS NULL OR places > 0),
  is_open boolean NOT NULL DEFAULT true,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{key,label,type,required,max_words}]
  screening_rubric_id uuid REFERENCES public.rubrics(id),
  interview_rubric_id uuid REFERENCES public.rubrics(id),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, slug)
);

CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.recruitment_cycles(id) ON DELETE CASCADE,
  position_id uuid NOT NULL REFERENCES public.positions(id),
  second_choice_position_id uuid REFERENCES public.positions(id),
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL, -- NULL once anonymised
  stage public.application_stage NOT NULL DEFAULT 'received',
  -- public alias shown to blind reviewers, e.g. "C-7F3A"
  alias text NOT NULL DEFAULT ('C-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  university text,
  degree_program text,
  study_year text,
  languages text[] NOT NULL DEFAULT '{}',
  heard_from text,
  cv_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  extracted jsonb,                 -- AI-extracted CV facts (LinkedIn, nationality, ...) + provenance
  extracted_at timestamptz,
  consent_at timestamptz NOT NULL,
  consent_version text NOT NULL,
  decision_reason text,
  decided_at timestamptz,
  decided_by uuid,
  offer_sent_at timestamptz,
  offer_responded_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  anonymized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_decision_reason CHECK (
    stage NOT IN ('rejected', 'offer_sent', 'offer_accepted', 'waitlisted') OR decision_reason IS NOT NULL
    OR anonymized_at IS NOT NULL)
);
-- one application per person and cycle
CREATE UNIQUE INDEX applications_one_per_cycle ON public.applications (cycle_id, person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX applications_alias ON public.applications (cycle_id, alias);
CREATE INDEX applications_stage ON public.applications (cycle_id, stage);
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Who may see and score which application, and at which stage
CREATE TABLE public.application_reviewers (
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  stage public.review_stage NOT NULL DEFAULT 'screening',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid,
  due_at timestamptz,
  assignment_method text NOT NULL DEFAULT 'manual' CHECK (assignment_method IN ('manual', 'optimizer')),
  PRIMARY KEY (application_id, reviewer_id, stage)
);
CREATE INDEX application_reviewers_reviewer ON public.application_reviewers (reviewer_id, stage);

-- Reviewer pool per cycle: capacity and expertise feed the assignment optimiser
CREATE TABLE public.reviewer_pool (
  cycle_id uuid NOT NULL REFERENCES public.recruitment_cycles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  max_reviews integer NOT NULL DEFAULT 15 CHECK (max_reviews >= 0),
  position_ids uuid[] NOT NULL DEFAULT '{}',  -- tracks this reviewer knows best
  is_senior boolean NOT NULL DEFAULT false,
  PRIMARY KEY (cycle_id, user_id)
);

-- Declared conflicts of interest (friend, flatmate, same team ...) - never assigned
CREATE TABLE public.review_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  reason text,
  declared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reviewer_id, application_id)
);

-- Scorecards. Hidden from other reviewers until their own review is submitted.
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id),
  stage public.review_stage NOT NULL,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {"criterion_key": 1..5}
  recommendation public.recommendation,
  comment text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, reviewer_id, stage),
  CONSTRAINT reviews_submitted_complete CHECK (submitted_at IS NULL OR recommendation IS NOT NULL)
);
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE public.application_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.app_users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  visibility text NOT NULL DEFAULT 'hr' CHECK (visibility IN ('hr', 'reviewers')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_comments_app ON public.application_comments (application_id, created_at);

CREATE TABLE public.interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  round integer NOT NULL DEFAULT 1 CHECK (round BETWEEN 1 AND 5),
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 10 AND 240),
  format text NOT NULL DEFAULT 'online' CHECK (format IN ('online', 'in_person')),
  location text,
  interviewer_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled', 'no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX interviews_when ON public.interviews (scheduled_at);
