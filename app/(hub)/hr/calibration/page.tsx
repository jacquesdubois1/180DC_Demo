import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RankScatter } from "@/components/charts/rank-scatter";
import { SeverityChart } from "@/components/charts/severity-chart";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { alphaLabel, krippendorffAlphaInterval } from "@/lib/analytics/agreement";
import { calibrate, reviewScore } from "@/lib/analytics/calibration";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getCycleReviews, resolveCycle } from "@/lib/hr/queries";

export const metadata: Metadata = { title: "Score calibration" };

export default async function CalibrationPage(props: PageProps<"/hr/calibration">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const stage = sp.stage === "interview" ? "interview" : "screening";
  const { reviews, criteria } = await getCycleReviews(user, cycle.id, stage);
  const weights = Object.fromEntries(criteria.map((c) => [c.key, c.weight]));
  const obs = reviews.map((r) => ({ applicationId: r.application_id, reviewerId: r.reviewer_id, score: reviewScore(r.scores, weights) }))
    .filter((o): o is { applicationId: string; reviewerId: string; score: number } => o.score !== null);
  const result = calibrate(obs);
  const people = await withUser(user.id, async (sql) => {
    const reviewers = await sql<{ id: string; display_name: string }[]>`select id, display_name from app_users`;
    const apps = await sql<{ id: string; alias: string; name: string | null; stage: string; position_name: string }[]>`
      select id, alias, nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') as name, stage::text, position_name
      from v_applications where cycle_id = ${cycle.id}`;
    return { reviewers: new Map(reviewers.map((r) => [r.id, r.display_name])), apps: new Map(apps.map((a) => [a.id, a])) };
  });

  // inter-rater reliability per criterion (Krippendorff's alpha, interval)
  type Rev = (typeof reviews)[number];
  const byApp = new Map<string, Rev[]>();
  reviews.forEach((r) => byApp.set(r.application_id, [...(byApp.get(r.application_id) ?? []), r]));
  const alphas = criteria.map((c) => {
    const units = [...byApp.values()].map((rs) => rs.map((r) => r.scores?.[c.key]).filter((v): v is number => typeof v === "number"));
    return { ...c, ...krippendorffAlphaInterval(units) };
  });
  const overall = krippendorffAlphaInterval([...byApp.values()].map((rs) => rs.map((r) => reviewScore(r.scores, weights)).filter((v): v is number => v !== null)));

  const sevRows = [...result.reviewers].sort((a, b) => a.severity - b.severity)
    .map((r) => ({ name: people.reviewers.get(r.reviewerId) ?? "?", severity: r.severity, se: r.se, n: r.n }));
  const movers = [...result.candidates].map((c) => ({ ...c, shift: c.rankRaw - c.rankCalibrated }))
    .filter((c) => people.apps.get(c.applicationId)).sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).slice(0, 8);
  const disagreements = result.candidates.filter((c) => c.disagreement >= 1.5).sort((a, b) => b.disagreement - a.disagreement).slice(0, 8);
  const top = [...result.candidates].sort((a, b) => a.rankCalibrated - b.rankCalibrated).slice(0, 12);
  const harshest = sevRows[0];
  const mildest = sevRows[sevRows.length - 1];

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Score calibration"
        description="Some reviewers grade harder than others. Because every candidate gets different reviewers, raw averages partly measure luck. This page estimates each reviewer's severity across the whole cycle and corrects for it."
        actions={<>
          <div className="inline-flex rounded-lg border border-line p-0.5 text-[13px]">
            {(["screening", "interview"] as const).map((s) => (
              <Link key={s} href={`?cycle=${cycle.slug}&stage=${s}`} className={`rounded-md px-3 py-1.5 font-medium capitalize ${stage === s ? "bg-brand text-white dark:text-[#0d1a12]" : "text-ink-2"}`}>{s}</Link>
            ))}
          </div>
          <CycleSwitcher cycles={cycles} current={cycle.slug} />
        </>} />

      {!obs.length ? <EmptyState title="No submitted scorecards yet">Calibration needs submitted reviews from several reviewers.</EmptyState> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Scorecards analysed" value={obs.length} sub={`${result.candidates.length} candidates · ${result.reviewers.length} reviewers`} />
            <Stat label="Variance due to reviewer" value={`${Math.round(result.reviewerVarianceShare * 100)}%`} sub="of score differences is who reviewed, not who applied" tone={result.reviewerVarianceShare > 0.1 ? "warn" : "default"} />
            <Stat label="Agreement (Krippendorff α)" value={Number.isFinite(overall.alpha) ? overall.alpha.toFixed(2) : "–"} sub={alphaLabel(overall.alpha)} />
            <Stat label="Rank changes ≥ 5 places" value={result.candidates.filter((c) => Math.abs(c.rankRaw - c.rankCalibrated) >= 5).length} sub="after removing reviewer severity" tone="brand" />
          </div>

          <Card className="mt-5 border-info/30 bg-info-soft/30">
            <CardContent className="flex gap-3 pt-5 text-[13.5px] text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
              <p>
                <b className="text-ink">How to read this:</b> {harshest && mildest ? <>{harshest.name} scores on average <b>{Math.abs(harshest.severity).toFixed(2)} points lower</b> than the average reviewer, {mildest.name} <b>{mildest.severity.toFixed(2)} points higher</b>. </> : null}
                A candidate reviewed by two strict reviewers would otherwise look weaker than an equally good candidate with lenient reviewers. The calibrated score (model: score = overall level + candidate quality + reviewer severity + noise) removes that effect. Use it as a second opinion for borderline decisions - decisions remain with the panel.
              </p>
            </CardContent>
          </Card>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Reviewer severity</CardTitle><CardDescription>Points relative to the average reviewer, 95% interval</CardDescription></div></CardHeader>
              <CardContent><SeverityChart rows={sevRows} /></CardContent>
            </Card>
            <Card>
              <CardHeader><div><CardTitle>Raw rank vs. calibrated rank</CardTitle><CardDescription>Blue: candidates who move 5+ places after calibration</CardDescription></div></CardHeader>
              <CardContent>
                <RankScatter points={result.candidates.map((c) => ({ alias: people.apps.get(c.applicationId)?.alias ?? "", raw: c.rankRaw, cal: c.rankCalibrated, shift: c.rankRaw - c.rankCalibrated }))} />
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Calibrated ranking</CardTitle><CardDescription>Top candidates by estimated quality (± standard error)</CardDescription></div></CardHeader>
              <CardContent className="pt-2">
                <Table>
                  <THead><TR><TH>#</TH><TH>Candidate</TH><TH className="text-right">Raw avg</TH><TH className="text-right">Calibrated</TH><TH className="text-right">Rank Δ</TH></TR></THead>
                  <TBody>
                    {top.map((c) => {
                      const a = people.apps.get(c.applicationId);
                      const shift = c.rankRaw - c.rankCalibrated;
                      return (
                        <TR key={c.applicationId}>
                          <TD className="tabular text-ink-3">{c.rankCalibrated}</TD>
                          <TD><Link href={`/hr/applications/${c.applicationId}`} className="font-medium hover:text-brand">{a?.name ?? a?.alias}</Link>
                            <div className="text-[12px] text-ink-3">{a?.position_name}</div></TD>
                          <TD className="text-right tabular">{c.rawMean.toFixed(2)}</TD>
                          <TD className="text-right font-semibold tabular">{c.calibrated.toFixed(2)} <span className="font-normal text-ink-3">±{c.se.toFixed(2)}</span></TD>
                          <TD className={`text-right tabular ${shift > 0 ? "text-brand" : shift < 0 ? "text-danger" : "text-ink-3"}`}>{shift > 0 ? `+${shift}` : shift}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <div className="space-y-5">
              <Card>
                <CardHeader><div><CardTitle>Does the rubric work?</CardTitle><CardDescription>Agreement between reviewers per criterion (α ≥ 0.8 reliable, 0.67-0.8 tentative)</CardDescription></div></CardHeader>
                <CardContent className="pt-2">
                  <Table>
                    <THead><TR><TH>Criterion</TH><TH className="text-right">α</TH><TH>Interpretation</TH></TR></THead>
                    <TBody>
                      {alphas.map((a) => (
                        <TR key={a.key}><TD>{a.label}</TD><TD className="text-right font-semibold tabular">{Number.isFinite(a.alpha) ? a.alpha.toFixed(2) : "–"}</TD>
                          <TD><Badge tone={a.alpha >= 0.8 ? "brand" : a.alpha >= 0.667 ? "neutral" : "warn"}>{alphaLabel(a.alpha)}</Badge></TD></TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><div><CardTitle>Discuss these</CardTitle><CardDescription>Biggest disagreements between reviewers (≥ 1.5 points apart)</CardDescription></div></CardHeader>
                <CardContent className="pt-2">
                  {disagreements.length ? (
                    <ul className="divide-y divide-line text-[13.5px]">
                      {disagreements.map((d) => {
                        const a = people.apps.get(d.applicationId);
                        return <li key={d.applicationId} className="flex items-center gap-3 py-2">
                          <Link href={`/hr/applications/${d.applicationId}`} className="flex-1 truncate font-medium hover:text-brand">{a?.name ?? a?.alias}</Link>
                          <span className="text-ink-3">{d.n} reviews</span><Badge tone="warn">spread {d.disagreement.toFixed(1)}</Badge></li>;
                      })}
                    </ul>
                  ) : <p className="text-[13px] text-ink-3">No large disagreements.</p>}
                </CardContent>
              </Card>
              {movers.length ? (
                <p className="text-[12.5px] text-ink-3">Largest rank changes: {movers.slice(0, 4).map((m) => `${people.apps.get(m.applicationId)?.alias} (${m.shift > 0 ? "+" : ""}${m.shift})`).join(", ")}.</p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
