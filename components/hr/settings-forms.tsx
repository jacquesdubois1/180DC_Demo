"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PLACEHOLDERS } from "@/lib/email/render";
import { createCycle, updateCycle, updatePosition, updateTemplate } from "@/lib/hr/settings-actions";

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved"); else toast.error(r.error);
    });
  return { pending, run };
}

export function CycleControls({ cycle }: { cycle: { id: string; status: string; retention_days: number; blind_screening: boolean; reviewers_per_application: number } }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select defaultValue={cycle.status} className="w-36" disabled={pending}
        onChange={(e) => run(() => updateCycle(cycle.id, { status: e.target.value as "draft" | "open" | "closed" | "archived" }))}>
        <option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option><option value="archived">Archived</option>
      </Select>
      <label className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
        <input type="checkbox" defaultChecked={cycle.blind_screening} onChange={(e) => run(() => updateCycle(cycle.id, { blindScreening: e.target.checked }))} />Blind screening
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">Reviewers
        <Input type="number" min={1} max={5} defaultValue={cycle.reviewers_per_application} className="w-16"
          onBlur={(e) => run(() => updateCycle(cycle.id, { reviewersPerApplication: Number(e.target.value) }))} />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">Delete rejected after
        <Input type="number" min={30} max={1095} defaultValue={cycle.retention_days} className="w-20"
          onBlur={(e) => run(() => updateCycle(cycle.id, { retentionDays: Number(e.target.value) }))} />days
      </label>
    </div>
  );
}

export function PositionControls({ position }: { position: { id: string; places: number | null; is_open: boolean } }) {
  const { pending, run } = useAction();
  return (
    <div className="flex items-center gap-2">
      <Input type="number" min={1} placeholder="no cap" defaultValue={position.places ?? ""} className="w-24" disabled={pending}
        onBlur={(e) => run(() => updatePosition(position.id, { places: e.target.value ? Number(e.target.value) : null }))} aria-label="Places" />
      <label className="flex items-center gap-1.5 text-[13px]">
        <input type="checkbox" defaultChecked={position.is_open} onChange={(e) => run(() => updatePosition(position.id, { isOpen: e.target.checked }))} />open
      </label>
    </div>
  );
}

export function NewCycleDialog({ cycles }: { cycles: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New cycle</Button></DialogTrigger>
      <DialogContent title="New recruitment cycle" description="Tracks, questions, rubrics and the reviewer pool are copied from the cycle you choose.">
        <form action={(fd) => run(async () => { const r = await createCycle(fd); if (r.ok) setOpen(false); return r; })} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input name="name" placeholder="Autumn 2027" required /></Field>
          <Field label="URL slug"><Input name="slug" placeholder="autumn-2027" required /></Field>
          <Field label="Opens"><Input name="opensAt" type="date" required /></Field>
          <Field label="Closes"><Input name="closesAt" type="date" required /></Field>
          <Field label="Delete rejected after (days)"><Input name="retentionDays" type="number" defaultValue={180} min={30} max={1095} /></Field>
          <Field label="Copy setup from">
            <Select name="copyFrom" defaultValue={cycles[0]?.id ?? ""}>
              <option value="">Nothing</option>{cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="submit" disabled={pending}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const HR_PLACEHOLDERS = ["first_name", "position", "cycle", "sender_name", "scheduling_link"];

export function TemplateEditor({ t, placeholders = HR_PLACEHOLDERS }: {
  t: { id: string; name: string; subject: string; body: string; requires_review: boolean; is_active: boolean; trigger_stage: string | null; variant: string };
  placeholders?: string[];
}) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [review, setReview] = useState(t.requires_review);
  const [active, setActive] = useState(t.is_active);
  const { pending, run } = useAction();
  return (
    <div className="space-y-2 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.name}</span>
        {t.trigger_stage ? <Badge tone="info">sent when moved to {t.trigger_stage.replace("_", " ")}</Badge> : null}
        {t.variant !== "A" ? <Badge tone="violet">variant {t.variant}</Badge> : null}
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-36" aria-label="Body" />
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />Needs approval before sending</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
        <span className="text-ink-3" title={placeholders.map((k) => `{{${k}}}: ${PLACEHOLDERS[k] ?? ""}`).join("\n")}>
          Placeholders: {placeholders.slice(0, 3).map((k) => `{{${k}}}`).join(", ")}, … (hover)</span>
        <Button size="sm" className="ml-auto" disabled={pending} onClick={() => run(() => updateTemplate(t.id, { subject, body, requiresReview: review, isActive: active }))}>Save</Button>
      </div>
    </div>
  );
}
