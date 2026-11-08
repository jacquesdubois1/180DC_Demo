import { AlertTriangle, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { Funnel } from "@/components/charts/funnel";
import { TimeSeries } from "@/components/charts/time-series";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Progress, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getReviewerPool, resolveCycle } from "@/lib/hr/queries";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Recruitment overview" };

export default async function HrOverview(props: PageProps<"/hr">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const [data, pool] = await Promise.all([
    withUser(user.id, async (sql) => {
      const [totals] = await sql<{ total: number; active: number; decided: number; avg_days_to_decision: number | null; emails_review: number; unassigned: number }[]>`
        select count(*)::int as total,
               count(*) filter (where stage in ('received','screening','interview','final_review','waitlisted','offer_sent'))::int as active,
               count(*) filter (where decided_at is not null)::int as decided,
               round(avg(extract(epoch from decided_at - submitted_at) / 86400)::numeric, 1) as avg_days_to_decision,
               (select count(*)::int from email_outbox o join applications a2 on a2.id = o.application_id
                 where a2.cycle_id = ${cycle.id} and o.status = 'needs_review') as emails_review,
               count(*) filter (where stage in ('received','screening') and not exists (
                 select 1 from application_reviewers ar where ar.application_id = applications.id and ar.stage = 'screening'))::int as unassigned
        from applications where cycle_id = ${cycle.id}`;
      const funnel = await sql<{ received: number; screened: number; interviewed: number; offered: number; accepted: number }[]>`
        select coalesce(sum(received),0)::int received, coalesce(sum(screened),0)::int screened, coalesce(sum(interviewed),0)::int interviewed,
               coalesce(sum(offered),0)::int offered, coalesce(sum(accepted),0)::int accepted
        from v_hr_funnel where cycle_id = ${cycle.id}`;
      const perDay = await sql<{ day: string; n: number }[]>`
        select to_char(d, 'DD Mon') as day, coalesce(n, 0)::int as n
        from generate_series(date_trunc('day', (select min(submitted_at) from applications where cycle_id = ${cycle.id})),
                             date_trunc('day', least(now(), coalesce((select closes_at from recruitment_cycles where id = ${cycle.id}), now()))),
                             interval '1 day') d
        left join (select date_trunc('day', submitted_at) as day, count(*) as n from applications where cycle_id = ${cycle.id} group by 1) x on x.day = d
        order by d`;
      const sources = await sql<{ heard_from: string; n: number }[]>`
        select coalesce(heard_from, 'Unknown') as heard_from, count(*)::int as n from applications where cycle_id = ${cycle.id}
        group by 1 order by 2 desc`;
      const tracks = await sql<{ name: string; slug: string; places: number | null; applications: number; in_process: number; offers: number; accepted: number }[]>`
        select p.name, p.slug, p.places, count(a.id)::int as applications,
               count(a.id) filter (where a.stage in ('received','screening','interview','final_review'))::int as in_process,
               count(a.id) filter (where a.stage in ('offer_sent','offer_accepted','offer_declined'))::int as offers,
               count(a.id) filter (where a.stage = 'offer_accepted')::int as accepted
        from positions p left join applications a on a.position_id = p.id
        where p.cycle_id = ${cycle.id} group by p.id order by p.position`;
      return { totals, funnel: funnel[0], perDay, sources, tracks };
    }),
    getReviewerPool(user, cycle.id),
  ]);
  const t = data.totals;
  const f = data.funnel;

  return (
    <>
      <PageHeader eyebrow="Recruitment" title={`${cycle.name} overview`}
        description={cycle.closes_at ? `Applications ${cycle.status === "open" ? "close" : "closed"} on ${format(new Date(cycle.closes_at), "d MMMM yyyy")}.` : undefined}
        actions={<CycleSwitcher cycles={cycles} current={cycle.slug} />} />

      {(t.unassigned > 0 || t.emails_review > 0) && (
        <div className="mb-5 flex flex-wrap gap-2">
          {t.unassigned > 0 ? (
            <Link href={`/hr/assign?cycle=${cycle.slug}`} className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <AlertTriangle className="size-4" />{t.unassigned} application(s) have no reviewers yet - run the assignment
            </Link>
          ) : null}
          {t.emails_review > 0 ? (
            <Link href="/hr/emails" className="flex items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-[13px] text-info">
              <Mail className="size-4" />{t.emails_review} decision e-mail(s) waiting for review
            </Link>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Applications" value={t.total} sub={`${t.active} still in process`} />
        <Stat label="Interviewed" value={f.interviewed} sub={f.received ? `${Math.round((f.interviewed / f.received) * 100)}% of applicants` : undefined} />
        <Stat label="Offers (accepted)" value={`${f.offered} (${f.accepted})`} sub={f.offered ? `${Math.round((f.accepted / f.offered) * 100)}% acceptance` : undefined} tone="brand" />
        <Stat label="Avg. days to decision" value={t.avg_days_to_decision ?? "–"} sub={`${t.decided} decisions so far`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><div><CardTitle>Applications per day</CardTitle><CardDescription>Submission timing helps plan reviewer capacity</CardDescription></div></CardHeader>
          <CardContent><TimeSeries data={data.perDay.map((d) => ({ date: d.day, value: d.n }))} label="Applications" /></CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><div><CardTitle>Funnel</CardTitle><CardDescription>Applications that reached each step</CardDescription></div></CardHeader>
          <CardContent>
            <Funnel steps={[{ label: "Applied", value: f.received }, { label: "Screened", value: f.screened }, { label: "Interviewed", value: f.interviewed },
              { label: "Offer", value: f.offered }, { label: "Accepted", value: f.accepted }]} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><div><CardTitle>Tracks</CardTitle><CardDescription>Places versus offers per track</CardDescription></div></CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead><TR><TH>Track</TH><TH className="text-right">Applications</TH><TH className="text-right">In process</TH><TH className="text-right">Offers</TH><TH className="text-right">Accepted</TH><TH className="w-40">Places filled</TH></TR></THead>
              <TBody>
                {data.tracks.map((tr) => (
                  <TR key={tr.slug}>
                    <TD><Link className="font-medium hover:text-brand" href={`/hr/applications?cycle=${cycle.slug}&position=${tr.slug}`}>{tr.name}</Link></TD>
                    <TD className="text-right tabular">{tr.applications}</TD>
                    <TD className="text-right tabular">{tr.in_process}</TD>
                    <TD className="text-right tabular">{tr.offers}</TD>
                    <TD className="text-right tabular">{tr.accepted}</TD>
                    <TD>{tr.places ? (
                      <div className="flex items-center gap-2"><Progress value={tr.accepted / tr.places} /><span className="text-[12px] text-ink-3 tabular">{tr.accepted}/{tr.places}</span></div>
                    ) : <span className="text-[12px] text-ink-3">no cap</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><div><CardTitle>Where applicants heard about us</CardTitle><CardDescription>Use it to plan next cycle&apos;s marketing</CardDescription></div></CardHeader>
          <CardContent><BarList rows={data.sources.map((s) => ({ label: s.heard_from, value: s.n, sub: t.total ? `${Math.round((s.n / t.total) * 100)}%` : undefined }))} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><div><CardTitle>Reviewer progress</CardTitle><CardDescription>Submitted versus assigned scorecards in this cycle</CardDescription></div>
          <Link href={`/hr/calibration?cycle=${cycle.slug}`} className="text-[13px] font-medium text-brand hover:underline">Calibration analysis</Link></CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead><TR><TH>Reviewer</TH><TH>Role</TH><TH className="text-right">Assigned</TH><TH className="text-right">Submitted</TH><TH className="w-56">Progress</TH><TH className="text-right">Capacity</TH></TR></THead>
            <TBody>
              {pool.map((r) => (
                <TR key={r.user_id}>
                  <TD className="font-medium">{r.display_name}</TD>
                  <TD className="text-ink-3">{r.title}{r.is_senior ? " · senior" : ""}</TD>
                  <TD className="text-right tabular">{r.assigned}</TD>
                  <TD className="text-right tabular">{r.submitted}</TD>
                  <TD><Progress value={r.assigned ? r.submitted / r.assigned : 0} /></TD>
                  <TD className="text-right tabular text-ink-3">{r.max_reviews}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
