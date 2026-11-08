import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withService, withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { type AppRole, type CurrentUser, hasRole } from "./roles";
import { readDemoSession } from "./session";
import { supabaseServerClient } from "./supabase";

export type { AppRole, CurrentUser } from "./roles";
export { can, hasRole, ROLE_LABELS } from "./roles";

async function loadUser(userId: string): Promise<CurrentUser | null> {
  const rows = await withUser(userId, (sql) => sql<
    { id: string; email: string; display_name: string; department: string; title: string | null; is_demo: boolean; roles: AppRole[] }[]
  >`
    select u.id, u.email::text as email, u.display_name, u.department::text as department, u.title, u.is_demo,
           coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}') as roles
    from app_users u left join user_roles r on r.user_id = u.id
    where u.id = ${userId} and u.is_active
    group by u.id`);
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.display_name, department: u.department, title: u.title, roles: u.roles, isDemo: u.is_demo };
}

/**
 * Supabase sign-in: the first login of an allowed Google Workspace account creates
 * an app user with the basic `member` role; an admin grants further roles.
 */
async function provisionSupabaseUser(id: string, email: string, name: string): Promise<void> {
  const domain = email.split("@")[1]?.toLowerCase();
  const allowed = env().ALLOWED_EMAIL_DOMAINS;
  if (!allowed.length || !domain || !allowed.includes(domain)) return;
  await withService(async (sql) => {
    await sql`insert into app_users (id, email, display_name) values (${id}, ${email}, ${name})
              on conflict (id) do update set last_login_at = now()`;
    await sql`insert into user_roles (user_id, role) values (${id}, 'member') on conflict do nothing`;
  });
}

/** The signed-in user, or null. Deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const e = env();
  if (e.AUTH_PROVIDER === "demo") {
    const id = await readDemoSession();
    return id ? loadUser(id) : null;
  }
  const supabase = await supabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  let user = await loadUser(data.user.id);
  if (!user) {
    const name = (data.user.user_metadata?.full_name as string | undefined) ?? data.user.email.split("@")[0];
    await provisionSupabaseUser(data.user.id, data.user.email, name);
    user = await loadUser(data.user.id);
  }
  return user;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Page guard: signed in AND holding one of the roles (admin always passes). */
export async function requireRole(...roles: AppRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasRole(user, ...roles)) redirect("/forbidden");
  return user;
}
