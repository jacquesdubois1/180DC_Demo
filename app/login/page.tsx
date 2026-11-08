import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser, ROLE_LABELS } from "@/lib/auth";
import { signInDemo, signInWithGoogle } from "@/lib/auth/actions";
import type { AppRole } from "@/lib/auth/roles";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  if (await getCurrentUser()) redirect(next);
  const e = env();
  const personas = e.AUTH_PROVIDER === "demo"
    ? await withService((sql) => sql<{ id: string; display_name: string; title: string | null; roles: AppRole[] }[]>`
        select u.id, u.display_name, u.title, array_agg(r.role::text order by r.role) as roles
        from app_users u join user_roles r on r.user_id = u.id
        where u.is_demo and u.is_active group by u.id order by min(r.role), u.display_name`)
    : [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-12">
      <div className="mb-8"><BrandLockup /></div>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Sign in to the Hub</h1>
      <p className="mt-2 max-w-[60ch] text-ink-2">
        Recruitment and client outreach of 180 Degrees Consulting Barcelona in one place.
      </p>
      {sp.error ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {sp.error === "domain" ? "Please sign in with your 180DC Google Workspace account." : "Sign-in failed. Please try again."}
        </p>
      ) : null}

      {e.AUTH_PROVIDER === "supabase" ? (
        <form action={signInWithGoogle} className="mt-8">
          <input type="hidden" name="next" value={next} />
          <SubmitButton size="lg" pendingText="Redirecting…">Continue with your 180DC Google account</SubmitButton>
          <p className="mt-3 text-[13px] text-ink-3">Only accounts on {e.ALLOWED_EMAIL_DOMAINS.join(", ") || "the 180DC domain"} can sign in.</p>
        </form>
      ) : (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-[13px] text-ink-2">
            <ShieldCheck className="size-4 text-brand" />
            Demo environment with fictional data. Choose a persona to see the Hub through that role&apos;s permissions.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => (
              <form key={p.id} action={signInDemo}>
                <input type="hidden" name="userId" value={p.id} />
                <input type="hidden" name="next" value={next} />
                <button type="submit"
                  className="flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand hover:shadow-sm">
                  <Avatar name={p.display_name} className="size-9 text-[12px]" />
                  <span className="min-w-0">
                    <span className="block font-medium">{p.display_name}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">{p.title}</span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {p.roles.filter((r) => r !== "member" || p.roles.length === 1).map((r) => (
                        <Badge key={r} tone={r === "admin" ? "violet" : r === "hr" ? "brand" : r === "client_relations" ? "info" : r === "interviewer" ? "warn" : "neutral"}>
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))}
                    </span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
