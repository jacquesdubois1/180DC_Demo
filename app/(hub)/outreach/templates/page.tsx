import type { Metadata } from "next";
import { PosteriorChart } from "@/components/charts/posterior-chart";
import { TemplateEditor } from "@/components/hr/settings-forms";
import { AddVariantButton, PromoteButton, SequenceEditor } from "@/components/outreach/template-tools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { analyzeAb, LOSS_TOLERANCE, posteriorCurves } from "@/lib/outreach/abtest";
import { getTemplates } from "@/lib/outreach/queries";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Templates & A/B tests" };

const OUTREACH_PLACEHOLDERS = ["first_name", "organization", "sector", "project_idea", "sender_name", "unsubscribe_link"];

export default async function TemplatesPage() {
  const user = await requireRole("client_relations");
  const [templates, perf, sequences] = await Promise.all([
    getTemplates(user),
    withUser(user.id, (sql) => sql<{ template_id: string; key: string; variant: string; sent: number; replied: number }[]>`
      select template_id, key, variant, sent, replied from v_template_performance`),
    withUser(user.id, (sql) => sql<{ id: string; name: string; steps: { after_days: number; template_key: string }[]; active: number; completed: number; stopped: number }[]>`
      select s.id, s.name, s.steps,
             count(e.id) filter (where e.status = 'active')::int as active,
             count(e.id) filter (where e.status = 'completed')::int as completed,
             count(e.id) filter (where e.status = 'stopped')::int as stopped
      from email_sequences s left join sequence_enrollments e on e.sequence_id = s.id
      where s.department = 'client_relations' group by s.id order by s.created_at`),
  ]);
  const keys = [...new Set(templates.map((t) => t.key))];

  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Templates & A/B tests"
        description="Every first e-mail is an experiment. The Hub learns which wording gets more replies and shifts new sends towards it (Thompson sampling) - you decide when a test is over." />

      <div className="space-y-6">
        {keys.map((key) => {
          const list = templates.filter((t) => t.key === key);
          const stats = list.filter((t) => t.is_active).map((t) => {
            const p = perf.find((x) => x.template_id === t.id);
            return { variant: t.variant, sent: p?.sent ?? 0, replied: p?.replied ?? 0 };
          });
          const testing = stats.length >= 2;
          const ab = testing ? analyzeAb(stats) : null;
          const curves = testing ? posteriorCurves(stats) : null;
          const lead = ab ? ab.variants.reduce((p, c) => (c.pBest > p.pBest ? c : p)) : null;
          return (
            <Card key={key}>
              <CardHeader>
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">{list[0].name.replace(/\s*\([A-Z](?::[^)]*)?\)$/, "")}
                    {testing ? <Badge tone="violet">A/B test running · {stats.length} variants</Badge> : <Badge tone="neutral">single version</Badge>}</CardTitle>
                  <CardDescription>Template key <span className="font-mono">{key}</span>{list.some((t) => !t.is_active) ? ` · ${list.filter((t) => !t.is_active).length} paused variant(s)` : ""}</CardDescription>
                </div>
                <AddVariantButton templateKey={key} />
              </CardHeader>
              <CardContent className="space-y-5">
                {ab && curves && lead ? (
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <div className="mb-1 text-[13px] font-medium">Where the true reply rate probably lies</div>
                      <PosteriorChart data={curves} variants={stats.map((s) => s.variant)} />
                      <p className="mt-1 text-[12px] text-ink-3">Bayesian posterior (Beta prior 1/1) per variant. Narrow, separate curves = a reliable difference.</p>
                    </div>
                    <div className="space-y-3">
                      <Table>
                        <THead><TR><TH>Variant</TH><TH className="text-right">Sent</TH><TH className="text-right">Replies</TH><TH className="text-right">Rate</TH><TH className="text-right">90% interval</TH><TH className="text-right">P(best)</TH></TR></THead>
                        <TBody>
                          {ab.variants.map((v) => (
                            <TR key={v.variant}>
                              <TD className="font-medium">{v.variant}</TD>
                              <TD className="text-right tabular">{v.sent}</TD>
                              <TD className="text-right tabular">{v.replied}</TD>
                              <TD className="text-right tabular">{pct(v.rate)}</TD>
                              <TD className="text-right tabular text-ink-3">{pct(v.low)}–{pct(v.high)}</TD>
                              <TD className="text-right tabular font-medium">{pct(v.pBest)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                      <div className={`rounded-xl px-3 py-2.5 text-[13px] ${ab.decided ? "bg-brand-soft text-ink" : "bg-surface-2 text-ink-2"}`}>
                        <div className="font-medium">{ab.verdict}.</div>
                        {ab.probBBeatsA !== null ? <div className="mt-0.5 text-ink-2">P(B gets more replies than A) = {pct(ab.probBBeatsA)} · expected relative uplift {ab.expectedUplift !== null ? `${ab.expectedUplift > 0 ? "+" : ""}${pct(ab.expectedUplift)}` : "–"}</div> : null}
                        <div className="mt-0.5 text-[12px] text-ink-3">Stopping rule: a variant wins when choosing it costs less than {(LOSS_TOLERANCE * 100).toFixed(1)} reply-rate points in expectation (now {(lead.expectedLoss * 100).toFixed(2)}), or when it is best with ≥ 95% probability.</div>
                      </div>
                      {ab.winner ? <PromoteButton templateKey={key} variant={ab.winner} /> : null}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-3 xl:grid-cols-2">
                  {list.map((t) => <TemplateEditor key={t.id} t={t} placeholders={OUTREACH_PLACEHOLDERS} />)}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {sequences.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <div><CardTitle>Automatic follow-ups · {s.name}</CardTitle>
                <CardDescription>Counted from the first e-mail. Stops by itself when the lead replies, opts out or changes stage. Running now: {s.active} · finished: {s.completed} · stopped early: {s.stopped}</CardDescription></div>
            </CardHeader>
            <CardContent><SequenceEditor id={s.id} steps={s.steps} templateKeys={keys} /></CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
