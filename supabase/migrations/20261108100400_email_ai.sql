-- ============================================================================
-- E-MAIL (templates, outbox, suppression list, follow-up sequences) and AI runs
-- Outbox pattern: the app writes a row, a worker sends it. A slow provider never
-- blocks a click, and every e-mail that left the Hub is visible and auditable.
-- ============================================================================

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department public.department NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  variant text NOT NULL DEFAULT 'A' CHECK (variant ~ '^[A-Z]$'),
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,                 -- plain text with {{placeholders}}
  trigger_stage text,                 -- application stage that queues this template automatically
  requires_review boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, key, variant)
);
CREATE TRIGGER email_templates_updated_at BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department public.department NOT NULL,
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  template_variant text,
  to_email extensions.citext NOT NULL,
  to_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  from_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reply_to text,
  subject text NOT NULL,
  body_text text NOT NULL,
  status public.email_status NOT NULL DEFAULT 'queued',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider text,
  provider_message_id text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX email_outbox_due ON public.email_outbox (status, scheduled_for);
CREATE INDEX email_outbox_lead ON public.email_outbox (lead_id);
CREATE INDEX email_outbox_application ON public.email_outbox (application_id);

-- Nobody on this list is ever e-mailed again (opt-outs, bounces, complaints)
CREATE TABLE public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email extensions.citext,
  domain extensions.citext,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'manual', 'gdpr_erasure')),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT suppression_target CHECK ((email IS NULL) <> (domain IS NULL))
);
CREATE UNIQUE INDEX email_suppressions_email ON public.email_suppressions (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX email_suppressions_domain ON public.email_suppressions (domain) WHERE domain IS NOT NULL;

-- Follow-up sequences: "if no reply after 5 working days, send follow-up 1"
CREATE TABLE public.email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department public.department NOT NULL DEFAULT 'client_relations',
  steps jsonb NOT NULL,            -- [{"after_days": 5, "template_key": "followup_1"}, ...]
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  step_index integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  stop_reason text,
  enrolled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, lead_id, person_id)
);
CREATE INDEX sequence_enrollments_due ON public.sequence_enrollments (status, next_run_at);

-- Every AI call is logged with purpose, model, tokens and cost (transparency + budget)
CREATE TABLE public.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('cv_extraction', 'lead_research', 'email_draft', 'reply_classification')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  model text NOT NULL,
  input_summary text,
  output jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 5),
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.lead_suggestions
  ADD CONSTRAINT lead_suggestions_ai_run FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE SET NULL;
ALTER TABLE public.interactions
  ADD CONSTRAINT interactions_outbox FOREIGN KEY (email_outbox_id) REFERENCES public.email_outbox(id) ON DELETE SET NULL,
  ADD CONSTRAINT interactions_template FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE SET NULL;
