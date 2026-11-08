"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { setReviewers } from "@/lib/hr/actions";

export function ReviewerEditor({ applicationId, stage, pool, assigned, conflicts }: {
  applicationId: string; stage: "screening" | "interview";
  pool: { id: string; name: string; load: number; capacity: number }[]; assigned: string[]; conflicts: string[];
}) {
  const [sel, setSel] = useState<string[]>(assigned);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setSel(assigned); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Edit {stage} reviewers</Button></DialogTrigger>
      <DialogContent title={`${stage === "screening" ? "Screening" : "Interview"} reviewers`}
        description="Reviewers who already submitted a scorecard stay assigned. People with a declared conflict cannot be selected.">
        <ul className="space-y-1.5">
          {pool.map((p) => {
            const conflict = conflicts.includes(p.id);
            return (
              <li key={p.id}>
                <label className={`flex items-center gap-3 rounded-lg border border-line px-3 py-2 ${conflict ? "opacity-50" : "cursor-pointer hover:bg-surface-2"}`}>
                  <input type="checkbox" disabled={conflict} checked={sel.includes(p.id)}
                    onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                  <span className="flex-1">{p.name}{conflict ? " · conflict of interest" : ""}</span>
                  <span className="text-[12px] text-ink-3 tabular">{p.load}/{p.capacity} open</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const res = await setReviewers(applicationId, stage, sel);
            if (res.ok) { toast.success(res.message); setOpen(false); } else toast.error(res.error);
          })}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
