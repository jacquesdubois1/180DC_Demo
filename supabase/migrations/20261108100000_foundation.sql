-- ============================================================================
-- 180DC Hub - foundation: extensions, helper schema, enumerations, utilities
-- Runs unchanged on Supabase (supabase db push) and on plain PostgreSQL 15+.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- All helper functions live in their own schema, never exposed as tables
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations: a fixed vocabulary so a typo can never create a new stage
-- ---------------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin', 'hr', 'interviewer', 'client_relations', 'member');
CREATE TYPE public.life_role AS ENUM ('applicant', 'member', 'alumni', 'contact');
CREATE TYPE public.department AS ENUM (
  'board', 'hr', 'client_relations', 'consulting', 'analytics', 'events', 'finance', 'marketing', 'other');
CREATE TYPE public.org_type AS ENUM (
  'company', 'startup', 'social_enterprise', 'ngo', 'foundation', 'public_sector', 'university', 'other');
CREATE TYPE public.cycle_status AS ENUM ('draft', 'open', 'closed', 'archived');
CREATE TYPE public.application_stage AS ENUM (
  'received', 'screening', 'interview', 'final_review',
  'offer_sent', 'offer_accepted', 'offer_declined', 'waitlisted', 'rejected', 'withdrawn');
CREATE TYPE public.review_stage AS ENUM ('screening', 'interview');
CREATE TYPE public.recommendation AS ENUM ('strong_yes', 'yes', 'maybe', 'no');
CREATE TYPE public.lead_stage AS ENUM (
  'new', 'contacted', 'follow_up', 'replied', 'meeting', 'proposal',
  'won', 'lost', 'not_interested', 'on_hold');
CREATE TYPE public.interaction_type AS ENUM ('email_out', 'email_in', 'call', 'meeting', 'linkedin', 'note');
CREATE TYPE public.email_status AS ENUM (
  'draft', 'needs_review', 'queued', 'sending', 'sent', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Accent-free, lower-case text that can be used in indexes (unaccent itself is only STABLE)
CREATE OR REPLACE FUNCTION app.fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- Organisation name normalisation used for de-duplication:
-- "Ecoalf Recycled Fabrics, S.L." and "ECOALF recycled fabrics" -> "ecoalf recycled fabrics"
CREATE OR REPLACE FUNCTION app.normalize_org_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(app.fold(name), '[^a-z0-9 ]+', ' ', 'g'),
             '\m(s l u|s l|slu|sl|s a|sa|sau|gmbh|ag|ltd|limited|inc|llc|sas|sarl|bv|nv|plc|corp|co|scp|sccl|coop)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- Registrable domain from a website or e-mail address; free-mail providers return NULL
CREATE OR REPLACE FUNCTION app.extract_domain(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH d AS (
    SELECT lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(trim(coalesce(value, '')), '^.*@', ''),       -- e-mail -> domain
          '^[a-z]+://', '', 'i'),                                     -- scheme
        '^www\.|[/?#:].*$', '', 'g')) AS dom                          -- www. and path/port
  )
  SELECT CASE
    WHEN dom = '' OR dom !~ '\.' THEN NULL
    WHEN dom IN ('gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es',
                 'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'gmx.de', 'gmx.net',
                 'web.de', 'proton.me', 'protonmail.com', 'aol.com') THEN NULL
    ELSE dom END
  FROM d
$$;

-- Generic key/value settings (retention defaults, sending limits, feature flags)
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
