import { ArrowRight, CalendarClock, ClipboardCheck, Inbox, Mail, TimerReset, UserPlus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { can, requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export default async function Home() {
  const user = await requireUser();
  const first = user.name.split(" ")[0];
  const data = await withUser(user.id, async (sql) => {
    const reviews = await sql<{ application_id: string; alias: string; candidate_name: string | null; position_name: string; review_stage: string; due_at: string | null }[]>`
      select application_id, alias, candidate_name, position_name, review_stage::text, due_at
      from app.my_review_assignments()
      where my_submitted_at is null and application_stage in ('received', 'screening', 'interview')
      order by due_at nulls last limit 6`;
    const hr = can.hr(user)
      ? (await sql<{ new_apps: number; to_decide: number; offers_open: number; interviews_week: number; due_retention: number }[]>`
          select (select count(*)::int from applications where stage = 'received') as new_apps,
                 (select count(*)::int from applications where stage = 'final_review') as to_decide,
                 (select count(*)::int from applications where stage = 'offer_sent') as offers_open,
                 (select count(*)::int from interviews where scheduled_at between now() and now() + interval '7 days' and status = 'scheduled') as interviews_week,
                 (select count(*)::int from email_outbox where department = 'hr' and status = 'needs_review') as due_retention`)[0]
      : null;
    const cr = can.outreach(user)
      ? {
          stats: (await sql<{ overdue: number; due_week: number; replied: number; stale: number; queued: number }[]>`
            select count(*) filter (where is_overdue and owner_id = ${user.id})::int as overdue,
                   count(*) filter (where next_step_due between current_date and current_date + 7 and owner_id = ${user.id})::int as due_week,
                   count(*) filter (where stage = 'replied')::int as replied,
                   count(*) filter (where days_since_activity > 14 and stage in ('contacted', 'follow_up', 'replied', 'meeting', 'proposal'))::int as stale,
                   (select count(*)::int from email_outbox where department = 'client_relations' and status = 'queued') as queued
            from v_leads`)[0],
          due: await sql<{ id: string; organization_name: string; next_step: string | null; next_step_due: string; stage: string; is_overdue: boolean }[]>`
            select id, organization_name, next_step, next_step_due::text, stage::text, is_overdue from v_leads
            where owner_id = ${user.id} and next_step_due <= current_date + 7 and stage not in ('won', 'lost', 'not_interested')
            order by next_step_due limit 6`,
        }
      : null;
    return { reviews, hr, cr };
  });

  return (
    <>
      <PageHeader eyebrow={format(new Date(), "EEEE, d MMMM")} title={`Hi ${first}`}
        description="Here is what needs your attention today." />

      <div className="grid gap-5 xl:grid-cols-2">
        {can.review(user) ? (
          <Card>
            <CardHeader>
              <div><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4 text-brand" />Your open reviews</CardTitle>
                <CardDescription>Blind scorecards assigned to you</CardDescription></div>
              <Link href="/reviews" className="text-[13px] font-medium text-brand hover:underline">All reviews</Link>
            </CardHeader>
            <CardContent className="pt-3">
              {data.reviews.length ? (
                <ul className="divide-y divide-line">
                  {data.reviews.map((r) => (
                    <li key={r.application_id + r.review_stage}>
                      <Link href={`/reviews/${r.application_id}?stage=${r.review_stage}`} className="flex items-center gap-3 py-2.5 hover:text-brand">
                        <span className="font-mono text-[12px] text-ink-3">{r.alias}</span>
                        <span className="flex-1 truncate">{r.candidate_name ?? "Anonymous candidate"} · {r.position_name}</span>
                        <Badge tone={r.review_stage === "interview" ? "info" : "neutral"}>{r.review_stage}</Badge>
                        {r.due_at ? <span className="text-[12px] text-ink-3">due {format(new Date(r.due_at), "d MMM")}</span> : null}
                        <ArrowRight className="size-4 text-ink-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Nothing to review">You are all caught up.</EmptyState>}
            </CardContent>
          </Card>
        ) : null}

        {data.hr ? (
          <Card>
            <CardHeader><div><CardTitle className="flex items-center gap-2"><UserPlus className="size-4 text-brand" />Recruitment</CardTitle>
              <CardDescription>Spring 2027 cycle</CardDescription></div></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-4">
              <Tile href="/hr/pipeline?stage=received" label="New applications" value={data.hr.new_apps} />
              <Tile href="/hr/pipeline?stage=final_review" label="Waiting for decision" value={data.hr.to_decide} />
              <Tile href="/hr/pipeline?stage=offer_sent" label="Offers awaiting answer" value={data.hr.offers_open} />
              <Tile href="/hr/interviews" label="Interviews next 7 days" value={data.hr.interviews_week} />
              {data.hr.due_retention ? (
                <Link href="/hr/emails" className="col-span-full flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                  <Mail className="size-4" />{data.hr.due_retention} decision e-mail(s) waiting for your review before they are sent
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {data.cr ? (
          <Card>
            <CardHeader><div><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-brand" />Your follow-ups</CardTitle>
              <CardDescription>Leads you own with a next step due this week</CardDescription></div>
              <Link href="/outreach/pipeline?mine=1" className="text-[13px] font-medium text-brand hover:underline">Pipeline</Link></CardHeader>
            <CardContent className="pt-3">
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile href="/outreach/pipeline?mine=1&overdue=1" label="Overdue" value={data.cr.stats.overdue} tone={data.cr.stats.overdue ? "danger" : undefined} />
                <Tile href="/outreach/pipeline?mine=1" label="Due in 7 days" value={data.cr.stats.due_week} />
                <Tile href="/outreach/pipeline?stage=replied" label="Replies to handle" value={data.cr.stats.replied} />
                <Tile href="/outreach/pipeline?stale=1" label="Stale (>14 days)" value={data.cr.stats.stale} tone={data.cr.stats.stale ? "warn" : undefined} />
              </div>
              {data.cr.due.length ? (
                <ul className="divide-y divide-line">
                  {data.cr.due.map((l) => (
                    <li key={l.id}>
                      <Link href={`/outreach/leads/${l.id}`} className="flex items-center gap-3 py-2.5 hover:text-brand">
                        <span className="flex-1 truncate font-medium">{l.organization_name}</span>
                        <span className="hidden truncate text-[13px] text-ink-3 sm:block">{l.next_step}</span>
                        <Badge tone={l.is_overdue ? "danger" : "neutral"}>{format(new Date(l.next_step_due), "d MMM")}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No follow-ups due" icon={<TimerReset className="size-5" />}>Nice. Use the pipeline to plan next steps.</EmptyState>}
              {data.cr.stats.queued ? (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-3"><Inbox className="size-4" />{data.cr.stats.queued} outreach e-mail(s) queued for sending</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!can.review(user) && !data.hr && !data.cr ? (
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Welcome to the 180DC Hub</CardTitle></CardHeader>
            <CardContent className="text-ink-2">
              You are signed in as a member. Recruitment and client-outreach tools appear here once an admin gives you the matching role.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Tile({ href, label, value, tone }: { href: string; label: string; value: number; tone?: "danger" | "warn" }) {
  return (
    <Link href={href} className="rounded-xl border border-line px-3 py-2.5 transition hover:border-brand">
      <div className={`text-[22px] font-semibold tabular ${tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      <div className="text-[12px] text-ink-3">{label}</div>
    </Link>
  );
}
