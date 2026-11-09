/**
 * Connection strings from hosting integrations carry extra query parameters for other clients
 * (e.g. `supa=base-pooler.x`, `pgbouncer=true` in the URLs the Supabase integration puts into Vercel).
 * postgres.js would send unknown parameters to the server as session settings, which Postgres
 * rejects - so only the parameters libpq clients understand are kept.
 */
const KEEP = new Set(["sslmode", "application_name", "connect_timeout", "options", "target_session_attrs"]);

export function cleanDatabaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of [...u.searchParams.keys()]) if (!KEEP.has(key)) u.searchParams.delete(key);
  return u.toString();
}
