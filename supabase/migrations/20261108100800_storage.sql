-- Private bucket for CVs on Supabase Storage (skipped on plain PostgreSQL, where the shim has no storage schema).
-- Only the server reads it with the service role, after the row-level security check on public.files
-- (see app/api/files/[id]/route.ts); there are deliberately no storage policies for anon/authenticated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('applications', 'applications', false, 5242880, ARRAY['application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
