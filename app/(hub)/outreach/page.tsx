import { AlertTriangle, ArrowRight, GraduationCap, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { Funnel } from "@/components/charts/funnel";
import { RecomputeButton } from "@/components/outreach/recompute-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Progress, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { analyzeAb } from "@/lib/outreach/abtest";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getLeads } from "@/lib/outreach/queries";
import { reachedStages } from "@/lib/outreach/scoring";
import { FUNNEL, LEAD_META } from "@/lib/outreach/stages";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Outreach overview" };

export default async function OutreachOverview() {
  const user = await requireRole("client_relations");
  const [leads, extra] = await Promise.all([
    getLeads(user),
    withUser(user.id, async (sql) => ({
      history: await sql<{ entity_id: string; to_status: string }[]>`select entity_id, to_status from status_history where entity = 'lead'`,
      perf: await sql<{ key: string; variant: string; sent: number; replied: number }[]>`select key, variant, sent, replied from v_template_performance where key = 'first_touch'`,
      sent30: (await sql<{ n: number; replies: number }[]>`
        select count(*) filter (where o.sent_at > now() - interval '30 days')::int as n,
               (select count(*)::int from interactions i where i.type = 'email_in' and i.occurred_at > now() - interval '30 days') as replies
        from email_outbox o where o.department = 'client_relations' and o.status = 'sent'`)[0],
      owners: await sql<{ name: string; open: number; overdue: number; sent30: number; won: number }[]>`
        select u.display_name as name,
               count(l.id) filter (where l.stage not in ('won','lost','not_interested'))::int as open,
               count(l.id) filter (where l.next_step_due < current_date and l.stage not in ('won','lost','not_interested'))::int as overdue,
               (select count(*)::int from email_outbox o where o.from_user_id = u.id and o.status = 'sent' and o.sent_at > now() - interval '30 days') as sent30,
               count(l.id) filter (where l.stage = 'won')::int as won
        from app_users u join user_roles r on r.user_id = u.id and r.role = 'client_relations'
        left join leads l on l.owner_id = u.id group by u.id order by open desc`,
      capacity: (await sql<{ cycle_name: string; accepted_consultants: number; offers_open: number; teams: number }[]>`select * from app.team_capacity()`)[0],
      target: (await sql<{ value: { projects_per_term?: number } }[]>`select value from settings where key = 'outreach'`)[0]?.value?.projects_per_term ?? 8,
    })),
  ]);

  const hist = new Map<string, string[]>();
  extra.history.forEach((h) => hist.set(h.entity_id, [...(hist.get(h.entity_id) ?? []), h.to_status]));
  const reached = (stage: string) => leads.filter((l) => reachedStages(l.stage, hist.get(l.id) ?? []).includes(stage)).length;
  const open = leads.filter((l) => !LEAD_META[l.stage].closed);
  const won = leads.filter((l) => l.stage === "won").length;
  const forecast = open.reduce((s, l) => s + (l.win_probability ?? 0), 0);
  const stale = open.filter((l) => l.days_since_activity > 14 && l.stage !== "new").sort((a, b) => b.days_since_activity - a.days_since_activity).slice(0, 6);
  const ab = analyzeAb(extra.perf.map((p) => ({ variant: p.variant, sent: p.sent, replied: p.replied })));
  const bySource = Object.entries(leads.reduce<Record<string, { n: number; won: number }>>((acc, l) => {
    acc[l.source] = acc[l.source] ?? { n: 0, won: 0 };
    acc[l.source].n++;
    if (l.stage === "won") acc[l.source].won++;
    return acc;
  }, {})).sort((a, b) => b[1].n - a[1].n);
  const teams = extra.capacity?.teams ?? 0;
  const needed = Math.max(teams, extra.target);

  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Outreach overview" description="Where the pipeline stands, which messages work, and whether we will have enough projects for next term's consulting teams."
        actions={<RecomputeButton />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open leads" value={open.length} sub={`${leads.filter((l) => l.is_overdue).length} with an overdue next step`} tone={leads.some((l) => l.is_overdue) ? "warn" : "default"} />
        <Stat label="E-mails sent (30 days)" value={extra.sent30?.n ?? 0} sub={`${extra.sent30?.replies ?? 0} replies received`} />
        <Stat label="Reply rate (all time)" value={pct(reached("replied") / Math.max(reached("contacted"), 1))} sub="replied ÷ contacted" />
        <Stat label="Signed projects" value={won} sub={`target ${extra.target} per term`} tone="brand" />
        <Stat label="Forecast (expected)" value={`+${forecast.toFixed(1)}`} sub="sum of win probabilities of open leads" tone="brand" />
      </div>

      <Card className="mt-5">
        <CardHeader><div><CardTitle className="flex items-center gap-2"><Users className="size-4 text-brand" />Do we have enough projects?</CardTitle>
          <CardDescription>Recruitment ({extra.capacity?.cycle_name ?? "current cycle"}) staffs about {teams} consulting team(s); each needs one client project.</CardDescription></div></CardHeader>
        <CardContent>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13.5px]">
            <span><b className="text-[18px] tabular">{won}</b> signed</span>
            <span><b className="text-[18px] tabular">{(won + forecast).toFixed(1)}</b> expected incl. pipeline</span>
            <span><b className="text-[18px] tabular">{needed}</b> needed ({teams} teams from recruitment, target {extra.target})</span>
          </div>
          <Progress value={Math.min(1, (won + forecast) / Math.max(needed, 1))} className="h-2.5" />
          <p className="mt-2 text-[13px] text-ink-3">
            {won + forecast >= needed ? "On track: the expected pipeline covers the teams we will staff."
              : `Gap of about ${(needed - won - forecast).toFixed(1)} project(s): contact more high-fit organisations or follow up on stale leads.`}
          </p>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader><div><CardTitle>Funnel</CardTitle><CardDescription>Leads that reached each stage</CardDescription></div></CardHeader>
          <CardContent><Funnel steps={FUNNEL.map((f) => ({ label: f.label, value: reached(f.stage) }))} /></CardContent>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader><div><CardTitle>Which first e-mail works better?</CardTitle><CardDescription>Bayesian A/B test on reply rates (90% credible intervals)</CardDescription></div>
            <Link href="/outreach/templates" className="text-[13px] font-medium text-brand hover:underline">Templates</Link></CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {ab.variants.map((v) => (
                <li key={v.variant} className="grid grid-cols-[6rem_1fr_9rem] items-center gap-3 text-[13px]">
                  <span className="font-medium">Variant {v.variant}</span>
                  <span className="relative h-3 rounded-full bg-surface-2" title={`${v.replied}/${v.sent} replied; 90% interval ${pct(v.low, 1)}-${pct(v.high, 1)}`}>
                    <span className="absolute inset-y-0 rounded-full opacity-35" style={{ left: `${v.low * 250}%`, width: `${(v.high - v.low) * 250}%`, background: v.variant === "A" ? "var(--series-2)" : "var(--series-1)" }} />
                    <span className="absolute -top-0.5 size-4 rounded-full border-2 border-surface" style={{ left: `calc(${v.rate * 250}% - 8px)`, background: v.variant === "A" ? "var(--series-2)" : "var(--series-1)" }} />
                  </span>
                  <span className="text-right tabular"><b>{pct(v.rate, 1)}</b> <span className="text-ink-3">({v.replied}/{v.sent})</span></span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between text-[11px] text-ink-3"><span>0%</span><span>20%</span><span>40%</span></div>
            {ab.probBBeatsA !== null ? (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                <b>{pct(ab.probBBeatsA)}</b> probability that B gets more replies than A (expected uplift {ab.expectedUplift !== null ? `${ab.expectedUplift > 0 ? "+" : ""}${pct(ab.expectedUplift)}` : "–"}). {ab.verdict}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader><div><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warn" />Going stale</CardTitle><CardDescription>No activity for more than 14 days</CardDescription></div></CardHeader>
          <CardContent className="pt-2">
            <ul className="divide-y divide-line text-[13.5px]">
              {stale.map((l) => (
                <li key={l.id}><Link href={`/outreach/leads/${l.id}`} className="flex items-center gap-2 py-2 hover:text-brand">
                  <span className="flex-1 truncate font-medium">{l.organization_name}</span><Badge tone={LEAD_META[l.stage].tone}>{LEAD_META[l.stage].label}</Badge>
                  <span className="w-12 text-right text-[12px] text-warn tabular">{l.days_since_activity}d</span><ArrowRight className="size-3.5 text-ink-3" /></Link></li>
              ))}
              {!stale.length ? <li className="py-2 text-ink-3">Nothing stale.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Where good leads come from</CardTitle><CardDescription>Leads and signed projects by source</CardDescription></div></CardHeader>
          <CardContent>
            <BarList rows={bySource.map(([source, s]) => ({ label: source.replace("_", " "), value: s.n, sub: `${s.won} signed` }))} />
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-3"><GraduationCap className="size-3.5" />Esade-alumni contacts raise the fit score (Mo&apos;s strategy).</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Team activity</CardTitle><CardDescription>Ownership keeps follow-ups from falling through</CardDescription></div></CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead><TR><TH>Owner</TH><TH className="text-right">Open</TH><TH className="text-right">Overdue</TH><TH className="text-right">Sent 30d</TH></TR></THead>
              <TBody>{extra.owners.map((o) => (
                <TR key={o.name}><TD className="font-medium">{o.name}</TD><TD className="text-right tabular">{o.open}</TD>
                  <TD className={`text-right tabular ${o.overdue ? "text-danger" : ""}`}>{o.overdue}</TD><TD className="text-right tabular">{o.sent30}</TD></TR>
              ))}</TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
