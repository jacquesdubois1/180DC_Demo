"use client";

import { Cpu, Shuffle } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { AssignResult } from "@/lib/analytics/assignment";
import { applyAssignment, proposeAssignment } from "@/lib/hr/actions";

type Plan = AssignResult & { names: Record<string, string> };

export function AssignmentPlanner({ cycleId, needs }: { cycleId: string; needs: { screening: number; interview: number } }) {
  const [stage, setStage] = useState<"screening" | "interview">("screening");
  const [senior, setSenior] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const r = await proposeAssignment(cycleId, stage, senior);
    if (r.ok && r.data) setPlan(r.data);
    else if (!r.ok) toast.error(r.error);
  });
  const apply = () => start(async () => {
    if (!plan) return;
    const r = await applyAssignment(stage, plan.pairs.map((p) => ({ applicationId: p.applicationId, reviewerId: p.reviewerId })));
    if (r.ok) { toast.success(r.message); setPlan(null); } else toast.error(r.error);
  });

  const byApp = new Map<string, { reviewer: string; match: boolean }[]>();
  plan?.pairs.forEach((p) => byApp.set(p.applicationId, [...(byApp.get(p.applicationId) ?? []), { reviewer: plan.names[p.reviewerId], match: p.expertiseMatch }]));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div><CardTitle>Run the optimiser</CardTitle>
            <CardDescription>Integer linear program (HiGHS): full coverage, no conflicts of interest, capacity respected, balanced workload, track expertise preferred.</CardDescription></div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {(["screening", "interview"] as const).map((s) => (
              <button key={s} onClick={() => { setStage(s); setPlan(null); }}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium capitalize ${stage === s ? "bg-brand text-white dark:text-[#0d1a12]" : "text-ink-2"}`}>
                {s} <span className="opacity-75">({needs[s]} open)</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={senior} onChange={(e) => setSenior(e.target.checked)} />At least one senior reviewer per candidate
          </label>
          <Button onClick={run} disabled={pending} className="ml-auto"><Cpu />{pending && !plan ? "Solving…" : "Propose assignment"}</Button>
        </CardContent>
      </Card>

      {plan ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Assignments proposed" value={plan.pairs.length} sub={`${plan.method === "ilp" ? "optimal ILP" : "greedy fallback"} · ${plan.solveMs} ms`} />
            <Stat label="Expertise match" value={`${Math.round(plan.expertiseMatchRate * 100)}%`} sub="reviewer knows the track" tone="brand" />
            <Stat label="Highest workload" value={`${Math.round(plan.maxRelativeLoad * 100)}%`} sub="of a reviewer's capacity" tone={plan.maxRelativeLoad > 1 ? "danger" : "default"} />
            <Stat label="Still uncovered" value={plan.shortages.reduce((s, x) => s + x.missing, 0)} sub="reviewer slots without capacity" tone={plan.shortages.length ? "warn" : "default"} />
          </div>
          <Card>
            <CardHeader><div><CardTitle>Workload after assignment</CardTitle><CardDescription>Existing reviews (grey) plus new assignments (green) against capacity</CardDescription></div></CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {plan.loads.map((l) => (
                  <li key={l.reviewerId} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3 text-[13px]">
                    <span className="truncate">{plan.names[l.reviewerId]}</span>
                    <span className="relative h-3 overflow-hidden rounded-full bg-surface-2" title={`${l.before} existing + ${l.after - l.before} new / ${l.capacity}`}>
                      <span className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--chart-axis)] opacity-50" style={{ width: `${Math.min(100, (l.before / Math.max(l.capacity, 1)) * 100)}%` }} />
                      <span className="absolute inset-y-0 rounded-r-full bg-[var(--series-1)]" style={{ left: `${Math.min(100, (l.before / Math.max(l.capacity, 1)) * 100)}%`, width: `${Math.min(100, ((l.after - l.before) / Math.max(l.capacity, 1)) * 100)}%` }} />
                    </span>
                    <span className="text-right tabular text-ink-2">{l.after}/{l.capacity} <span className="text-ink-3">(+{l.after - l.before})</span></span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div><CardTitle>Proposed pairs</CardTitle><CardDescription>Review, then apply. New applications move to “In review”.</CardDescription></div>
              <Button onClick={apply} disabled={pending || !plan.pairs.length}><Shuffle />Apply {plan.pairs.length} assignments</Button>
            </CardHeader>
            <CardContent className="pt-2">
              <Table>
                <THead><TR><TH>Candidate</TH><TH>Reviewers</TH></TR></THead>
                <TBody>
                  {[...byApp.entries()].map(([app, revs]) => (
                    <TR key={app}><TD className="font-mono text-[12.5px]">{plan.names[app]}</TD>
                      <TD className="flex flex-wrap gap-1.5">{revs.map((r) => <Badge key={r.reviewer} tone={r.match ? "brand" : "neutral"}>{r.reviewer}{r.match ? " · expert" : ""}</Badge>)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
