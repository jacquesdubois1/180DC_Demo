"use server";

import { redirect } from "next/navigation";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";
import { clearDemoSession, createDemoSession } from "./session";
import { supabaseServerClient } from "./supabase";

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

/** Demo / staging only: sign in as one of the fictional personas. */
export async function signInDemo(formData: FormData) {
  const e = env();
  if (e.AUTH_PROVIDER !== "demo") throw new Error("Demo sign-in is disabled");
  const userId = String(formData.get("userId") ?? "");
  const ok = await withService((sql) => sql`
    update app_users set last_login_at = now() where id = ${userId} and is_demo and is_active returning id`);
  if (!ok.length) redirect("/login?error=unknown-user");
  await withService((sql) => sql`select app.log_event('auth.demo_sign_in', 'app_user', ${userId}::uuid, '{}'::jsonb)`);
  await createDemoSession(userId);
  redirect(safeNext(formData.get("next")));
}

/** Production: Google sign-in through Supabase Auth, limited to the Workspace domain. */
export async function signInWithGoogle(formData: FormData) {
  const e = env();
  const supabase = await supabaseServerClient();
  const next = safeNext(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${e.APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: e.ALLOWED_EMAIL_DOMAINS[0] ? { hd: e.ALLOWED_EMAIL_DOMAINS[0], prompt: "select_account" } : undefined,
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  if (env().AUTH_PROVIDER === "supabase") {
    const supabase = await supabaseServerClient();
    await supabase.auth.signOut();
  } else {
    await clearDemoSession();
  }
  redirect("/login");
}
