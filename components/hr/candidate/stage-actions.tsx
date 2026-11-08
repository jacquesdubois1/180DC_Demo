"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { moveApplication } from "@/lib/hr/actions";
import { type ApplicationStage, NEEDS_REASON, STAGE_META, TRANSITIONS } from "@/lib/hr/stages";

const PRIMARY: Partial<Record<ApplicationStage, ApplicationStage>> = {
  received: "screening", screening: "interview", interview: "final_review", final_review: "offer_sent", waitlisted: "offer_sent", offer_sent: "offer_accepted",
};

export function StageActions({ applicationId, stage, name }: { applicationId: string; stage: ApplicationStage; name: string }) {
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<ApplicationStage | null>(null);
  const [reason, setReason] = useState("");
  const options = TRANSITIONS[stage];
  const primary = PRIMARY[stage];

  const go = (to: ApplicationStage, note?: string) =>
    start(async () => {
      const res = await moveApplication(applicationId, to, note);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });

  const click = (to: ApplicationStage) => {
    if (NEEDS_REASON.includes(to)) {
      setReason("");
      setTarget(to);
    } else go(to);
  };

  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary && options.includes(primary) ? (
        <Button disabled={pending} onClick={() => click(primary)}>Move to {STAGE_META[primary].label}</Button>
      ) : null}
      {options.filter((o) => o !== primary).map((o) => (
        <Button key={o} disabled={pending} variant={o === "rejected" ? "outline" : "secondary"} size="sm"
          className={o === "rejected" ? "text-danger" : undefined} onClick={() => click(o)}>
          {STAGE_META[o].label}
        </Button>
      ))}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        {target ? (
          <DialogContent title={`${STAGE_META[target].label}: ${name}`}
            description="The reason is stored with the decision (GDPR: decisions are made and explained by people). The candidate e-mail is prepared for review.">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason…" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button variant={target === "rejected" ? "danger" : "primary"} disabled={reason.trim().length < 5 || pending}
                onClick={() => { go(target, reason); setTarget(null); }}>Confirm</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
