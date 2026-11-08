import type { Metadata } from "next";
import Link from "next/link";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { resolveCycle } from "@/lib/hr/queries";
import { format, isToday, isTomorrow } from "date-fns";

export const metadata: Metadata = { title: "Interviews" };

export default async function InterviewsPage(props: PageProps<"/hr/interviews">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const rows = await withUser(user.id, (sql) => sql<{ id: string; application_id: string; scheduled_at: string; duration_minutes: number; format: string;
    location: string | null; status: string; name: string; position_name: string; interviewers: string[]; scorecards: number }[]>`
    select i.id, i.application_id, i.scheduled_at, i.duration_minutes, i.format, i.location, i.status,
           v.first_name || ' ' || v.last_name as name, v.position_name,
           coalesce((select array_agg(u.display_name) from app_users u where u.id = any(i.interviewer_ids)), '{}') as interviewers,
           (select count(*)::int from reviews r where r.application_id = i.application_id and r.stage = 'interview' and r.submitted_at is not null) as scorecards
    from interviews i join v_applications v on v.id = i.application_id
    where v.cycle_id = ${cycle.id} order by i.scheduled_at`);
  const upcoming = rows.filter((r) => new Date(r.scheduled_at) >= new Date(new Date().setHours(0, 0, 0, 0)) && r.status === "scheduled");
  const past = rows.filter((r) => !upcoming.includes(r));
  const groups = new Map<string, (typeof rows)[number][]>();
  upcoming.forEach((r) => {
    const d = new Date(r.scheduled_at);
    const key = isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEEE, d MMMM");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Interviews" description="Schedule interviews from a candidate's page; interviewers get an interview scorecard automatically."
        actions={<CycleSwitcher cycles={cycles} current={cycle.slug} />} />
      {groups.size ? [...groups.entries()].map(([day, list]) => (
        <Card key={day} className="mb-4">
          <CardHeader><CardTitle>{day}</CardTitle></CardHeader>
          <CardContent className="pt-2">
            <ul className="divide-y divide-line">
              {list.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13.5px]">
                  <span className="w-14 font-semibold tabular">{format(new Date(i.scheduled_at), "HH:mm")}</span>
                  <Link href={`/hr/applications/${i.application_id}`} className="min-w-40 flex-1 font-medium hover:text-brand">{i.name}</Link>
                  <span className="text-ink-3">{i.position_name}</span>
                  <span className="text-ink-3">{i.duration_minutes} min · {i.format === "online" ? "online" : i.location}</span>
                  <span className="text-ink-2">{i.interviewers.join(", ")}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )) : <EmptyState title="No upcoming interviews" />}
      {past.length ? (
        <Card>
          <CardHeader><CardTitle>Past interviews</CardTitle></CardHeader>
          <CardContent className="pt-2">
            <ul className="divide-y divide-line">
              {past.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13.5px]">
                  <span className="w-28 text-ink-3">{format(new Date(i.scheduled_at), "d MMM, HH:mm")}</span>
                  <Link href={`/hr/applications/${i.application_id}`} className="flex-1 font-medium hover:text-brand">{i.name}</Link>
                  <Badge tone={i.scorecards >= i.interviewers.length ? "brand" : "warn"}>{i.scorecards}/{i.interviewers.length} scorecards</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
