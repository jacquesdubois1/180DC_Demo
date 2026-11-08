"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { declareConflict, saveReview } from "@/lib/hr/actions";
import { RECOMMENDATION_META, type Recommendation } from "@/lib/hr/stages";
import { cn } from "@/lib/utils";

export interface Criterion { key: string; label: string; description: string | null; anchors: Record<string, string>; weight: number }

export function Scorecard({ applicationId, stage, criteria, initial, submitted }: {
  applicationId: string; stage: "screening" | "interview"; criteria: Criterion[];
  initial: { scores: Record<string, number>; recommendation: Recommendation | null; comment: string | null } | null; submitted: boolean;
}) {
  const [scores, setScores] = useState<Record<string, number>>(initial?.scores ?? {});
  const [rec, setRec] = useState<Recommendation | null>(initial?.recommendation ?? null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [pending, start] = useTransition();
  const complete = criteria.every((c) => scores[c.key]) && !!rec;
  const weighted = criteria.reduce((s, c) => s + (scores[c.key] ?? 0) * c.weight, 0) / criteria.reduce((s, c) => s + (scores[c.key] ? c.weight : 0), 0 || 1);

  const save = (submit: boolean) => start(async () => {
    const r = await saveReview({ applicationId, stage, scores, recommendation: rec, comment, submit });
    if (r.ok) toast.success(r.message); else toast.error(r.error);
  });

  if (submitted) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-3 text-[13.5px] text-brand">
        <CheckCircle2 className="size-4" />Your scorecard is submitted and locked. Other reviewers&apos; scores are shown below.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {criteria.map((c) => (
        <fieldset key={c.key}>
          <legend className="text-[14px] font-medium">{c.label}{c.weight !== 1 ? <span className="ml-1.5 text-[12px] font-normal text-ink-3">weight ×{c.weight}</span> : null}</legend>
          {c.description ? <p className="text-[12.5px] text-ink-3">{c.description}</p> : null}
          <div className="mt-2 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={c.label}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={scores[c.key] === v}
                onClick={() => setScores((s) => ({ ...s, [c.key]: v }))}
                className={cn("rounded-lg border px-2 py-2 text-center transition",
                  scores[c.key] === v ? "border-brand bg-brand text-white dark:text-[#0d1a12]" : "border-line bg-surface hover:border-brand")}>
                <div className="text-[15px] font-semibold">{v}</div>
                {c.anchors?.[String(v)] ? <div className={cn("text-[10.5px] leading-tight", scores[c.key] === v ? "text-white/85 dark:text-[#0d1a12]/80" : "text-ink-3")}>{c.anchors[String(v)]}</div> : null}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset>
        <legend className="text-[14px] font-medium">Overall recommendation</legend>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.keys(RECOMMENDATION_META) as Recommendation[]).map((r) => (
            <button key={r} type="button" onClick={() => setRec(r)} aria-pressed={rec === r}
              className={cn("rounded-lg border px-3 py-2 text-[13px] font-medium transition",
                rec === r ? (r === "no" ? "border-danger bg-danger text-white" : r === "maybe" ? "border-warn bg-warn text-white" : "border-brand bg-brand text-white dark:text-[#0d1a12]")
                  : "border-line hover:border-brand")}>
              {RECOMMENDATION_META[r].label}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="text-[14px] font-medium" htmlFor="review-comment">Comment for the panel</label>
        <p className="text-[12.5px] text-ink-3">Evidence, not impressions: what in the answers supports your scores?</p>
        <Textarea id="review-comment" className="mt-2" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={pending} onClick={() => save(false)}>Save draft</Button>
        <Button disabled={pending || !complete} onClick={() => save(true)}>Submit scorecard</Button>
        {Object.keys(scores).length ? <span className="text-[13px] text-ink-3 tabular">Weighted average {Number.isFinite(weighted) ? weighted.toFixed(2) : "–"}</span> : null}
        <ConflictButton applicationId={applicationId} />
      </div>
    </div>
  );
}

function ConflictButton({ applicationId }: { applicationId: string }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm" className="ml-auto text-warn"><ShieldAlert />Conflict of interest</Button></DialogTrigger>
      <DialogContent title="Declare a conflict of interest" description="If you know this person (friend, flatmate, teammate…), HR will reassign the application. Your reason is only visible to HR.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. we live together" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await declareConflict(applicationId, reason);
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.error);
          })}>Declare conflict</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
