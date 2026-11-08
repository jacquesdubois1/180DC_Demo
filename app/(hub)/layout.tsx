import { FlaskConical } from "lucide-react";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { hasRole, requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";

export default async function HubLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const sections = NAV.filter((s) => !s.roles || hasRole(user, ...s.roles));

  // small counters in the sidebar: open reviews, overdue lead follow-ups
  const [counts] = await withUser(user.id, (sql) => sql<{ reviews: number; overdue: number; new_apps: number }[]>`
    select
      (select count(*)::int from app.my_review_assignments() where my_submitted_at is null
         and application_stage in ('received', 'screening', 'interview')) as reviews,
      (select count(*)::int from leads where owner_id = ${user.id} and next_step_due < current_date
         and stage not in ('won', 'lost', 'not_interested')) as overdue,
      (select count(*)::int from applications where stage = 'received') as new_apps`);
  const badges: Record<string, number> = {
    "/reviews": counts?.reviews ?? 0,
    "/outreach/pipeline": counts?.overdue ?? 0,
    "/hr/pipeline": counts?.new_apps ?? 0,
  };

  return (
    <div className="min-h-screen">
      <Sidebar sections={sections} user={user} badges={badges} />
      <div className="lg:pl-64">
        {env().DEMO_MODE ? (
          <div className="flex items-center gap-2 border-b border-warn/20 bg-warn-soft px-4 py-1.5 text-[12.5px] text-warn lg:px-8">
            <FlaskConical className="size-3.5" />
            Demo environment: all people and organisations are fictional. Do not enter real personal data.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
