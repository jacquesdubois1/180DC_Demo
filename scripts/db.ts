/**
 * Database CLI for local development and CI (no Docker / Supabase CLI required).
 *
 *   npm run db:migrate   apply pending migrations from supabase/migrations
 *   npm run db:reset     drop everything, re-create, migrate and seed (LOCAL ONLY)
 *   npm run db:seed      load supabase/seed.sql
 *
 * Applied versions are recorded in supabase_migrations.schema_migrations, the same
 * table the Supabase CLI uses - so `supabase db push` sees them as applied too.
 * On a plain PostgreSQL the Supabase platform shim (supabase/local) is installed first.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { cleanDatabaseUrl } from "../lib/db/url";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const SHIM = path.join(ROOT, "supabase", "local", "00_supabase_shim.sql");
const SEED = path.join(ROOT, "supabase", "seed.sql");

// migrations need a direct / session-mode connection; the Vercel Supabase integration calls it POSTGRES_URL_NON_POOLING
const url = cleanDatabaseUrl([process.env.DATABASE_URL_DIRECT, process.env.POSTGRES_URL_NON_POOLING, process.env.DATABASE_URL, process.env.POSTGRES_URL]
  .find((v) => v) ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres");

function isLocal(u: string) {
  const host = new URL(u).hostname;
  return ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host);
}

async function main() {
  const cmd = process.argv[2] ?? "migrate";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (cmd === "reset") {
      if (!isLocal(url) && !process.argv.includes("--force")) {
        throw new Error(`Refusing to reset non-local database ${new URL(url).host}. Use --force if you really mean it.`);
      }
      await sql.unsafe(`
        DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE;
        DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
        CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT USAGE ON SCHEMA public TO public;`);
      console.log("✓ schemas dropped");
      await migrate(sql);
      await seed(sql);
    } else if (cmd === "migrate") {
      await migrate(sql);
    } else if (cmd === "seed") {
      await seed(sql);
    } else {
      throw new Error(`Unknown command ${cmd}`);
    }
  } finally {
    await sql.end();
  }
}

async function migrate(sql: postgres.Sql) {
  const [{ supabase }] = await sql`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS supabase`;
  if (!supabase) {
    await sql.unsafe(readFileSync(SHIM, "utf8"));
    console.log("✓ local Supabase shim installed (plain PostgreSQL detected)");
  }
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY, statements text[], name text);`);
  const applied = new Set(
    (await sql`SELECT version FROM supabase_migrations.schema_migrations`).map((r) => r.version as string),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  let count = 0;
  for (const file of files) {
    const version = file.slice(0, 14);
    if (applied.has(version)) continue;
    const body = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const t0 = Date.now();
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
               VALUES (${version}, ${file.slice(15, -4)}, ${[body]})`;
    });
    count++;
    console.log(`✓ ${file} (${Date.now() - t0} ms)`);
  }
  console.log(count ? `✓ ${count} migration(s) applied` : "✓ database is up to date");
  // the app switches to these roles per request (withUser / withService); without membership every query fails
  const [roles] = await sql<{ authenticated: boolean; service: boolean }[]>`
    SELECT pg_has_role(current_user, 'authenticated', 'MEMBER') AS authenticated, pg_has_role(current_user, 'service_role', 'MEMBER') AS service`;
  if (!roles.authenticated || !roles.service) {
    console.warn(`! ${String(await sql`select current_user`.then((r) => r[0].current_user))} cannot switch to the roles authenticated/service_role -`
      + " connect as the database owner (postgres) or GRANT authenticated, service_role TO <user>.");
  }
}

async function seed(sql: postgres.Sql) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM public.app_users`;
  if (n > 0) {
    console.log(`✓ database already contains ${n} user(s) - demo data not loaded again`);
    return;
  }
  const body = readFileSync(SEED, "utf8");
  const t0 = Date.now();
  await sql.begin((tx) => tx.unsafe(body));
  console.log(`✓ seed loaded (${Date.now() - t0} ms)`);
  // derived data: lead scores (same code the app runs nightly)
  const { recomputeScores } = await import("../lib/outreach/score-job");
  const r = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
    await tx.unsafe("set local role service_role");
    return recomputeScores(tx as never);
  });
  console.log(`✓ ${r.scored} lead scores computed`);
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
