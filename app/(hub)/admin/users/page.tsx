import type { Metadata } from "next";
import { UserRoleEditor } from "@/components/admin/admin-tools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import type { AppRole } from "@/lib/auth/roles";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const admin = await requireRole("admin");
  const users = await withUser(admin.id, (sql) => sql<{ id: string; email: string; display_name: string; department: string; title: string | null;
    is_active: boolean; is_demo: boolean; last_login_at: string | null; roles: AppRole[]; open_reviews: number; open_leads: number }[]>`
    select u.id, u.email::text, u.display_name, u.department::text, u.title, u.is_active, u.is_demo, u.last_login_at,
           coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}') as roles,
           (select count(*)::int from application_reviewers ar where ar.reviewer_id = u.id
              and not exists (select 1 from reviews rv where rv.application_id = ar.application_id and rv.reviewer_id = u.id and rv.stage = ar.stage and rv.submitted_at is not null)) as open_reviews,
           (select count(*)::int from leads l where l.owner_id = u.id and l.stage not in ('won', 'lost', 'not_interested')) as open_leads
    from app_users u left join user_roles r on r.user_id = u.id
    group by u.id order by u.is_active desc, u.display_name`);
  const e = env();
  return (
    <>
      <PageHeader eyebrow="Admin" title="Users & roles"
        description="Roles decide what the database shows each person (row-level security), not only which menu items appear. Admins can do everything; a member without roles only sees the home page." />
      <Card className="mb-5">
        <CardHeader><div><CardTitle>How people get access</CardTitle>
          <CardDescription>{e.AUTH_PROVIDER === "supabase"
            ? `Anyone with a ${e.ALLOWED_EMAIL_DOMAINS.join(" / ") || "(no domain configured)"} Google account can sign in and starts as a plain member. Grant roles here.`
            : "Demo mode: sign-in uses the fictional personas. With Google Workspace sign-in, new members appear here after their first login."}</CardDescription></div></CardHeader>
      </Card>
      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id} className={u.is_active ? "" : "opacity-60"}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={u.display_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{u.display_name}
                    {!u.is_active ? <Badge tone="danger">deactivated</Badge> : null}{u.is_demo ? <Badge tone="outline">demo persona</Badge> : null}</div>
                  <div className="text-[12.5px] text-ink-3">{u.email}{u.last_login_at ? ` · last login ${formatDistanceToNow(new Date(u.last_login_at))} ago` : ""}</div>
                </div>
                <div className="text-right text-[12.5px] text-ink-3">
                  {u.open_reviews ? <div>{u.open_reviews} open scorecard(s)</div> : null}
                  {u.open_leads ? <div>{u.open_leads} open lead(s)</div> : null}
                </div>
              </div>
              <UserRoleEditor user={u} isSelf={u.id === admin.id} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
