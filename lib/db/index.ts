import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";
import { cleanDatabaseUrl } from "./url";

/**
 * Data access layer.
 *
 * The browser never talks to the database. Every query runs on the server inside a
 * transaction that first switches to the database role `authenticated` and sets the
 * caller's JWT claims - exactly what Supabase's API gateway does. The row-level
 * security policies in supabase/migrations therefore apply to every query, so a bug in
 * a page cannot leak data the user's role is not allowed to see.
 *
 *   withUser(user.id, (sql) => sql`select ...`)   -> RLS as that user
 *   withService((sql) => ...)                     -> service role (bypasses RLS), for
 *                                                   the public form, cron jobs, unsubscribe
 */

declare global {
  var __hubSql: postgres.Sql | undefined;
}

function client() {
  if (!globalThis.__hubSql) {
    globalThis.__hubSql = postgres(cleanDatabaseUrl(env().DATABASE_URL), {
      max: process.env.VERCEL ? 3 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required for Supabase's transaction pooler (port 6543)
      onnotice: () => {},
      types: {
        // return numerics as JS numbers (scores, probabilities); fine for our value ranges
        numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
        // calendar dates stay "YYYY-MM-DD" strings (no timezone shifts when rendered)
        date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      },
    });
  }
  return globalThis.__hubSql;
}

export type Tx = postgres.TransactionSql;

export async function withUser<T>(userId: string, fn: (sql: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return client().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  }) as Promise<T>;
}

export async function withService<T>(fn: (sql: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ role: "service_role" });
  return client().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx.unsafe("set local role service_role");
    return fn(tx);
  }) as Promise<T>;
}

/** Map Postgres errors raised by our functions to user-facing messages. */
export function dbErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42501") return "You do not have permission to do this.";
  if (e?.code === "23505") return "This already exists (duplicate).";
  if (e?.code === "22023" || e?.code === "P0002") return e.message ?? "Invalid request.";
  if (e?.code === "23514") return "The data does not satisfy a validation rule.";
  // unexpected: log the details server-side (Vercel function logs), show a generic message
  console.error("[db]", e?.code ?? "", e?.message ?? err);
  return "Something went wrong. Please try again.";
}
