import { NextResponse } from "next/server";
import { supabaseServerClient } from "@/lib/auth/supabase";
import { env } from "@/lib/env";

/**
 * Google sign-in, step 2: Supabase sends the user back here with a one-time code, which is
 * exchanged for a session cookie (PKCE). The Workspace domain is checked again on the server -
 * the `hd` hint sent to Google only pre-filters the account picker and can be bypassed.
 */
export async function GET(request: Request) {
  const e = env();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  if (e.AUTH_PROVIDER !== "supabase" || !code) return NextResponse.redirect(new URL("/login?error=oauth", e.APP_URL));

  const supabase = await supabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) return NextResponse.redirect(new URL("/login?error=oauth", e.APP_URL));

  const domain = data.user.email.split("@")[1]?.toLowerCase();
  if (!domain || !e.ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", e.APP_URL));
  }
  return NextResponse.redirect(new URL(next, e.APP_URL));
}
