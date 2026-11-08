"use client";

import { Plus, Trophy } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addVariant, promoteVariant, updateSequence } from "@/lib/outreach/actions";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error ?? "Something went wrong");
    });
  return { pending, run };
}

export function PromoteButton({ templateKey, variant }: { templateKey: string; variant: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" disabled={pending} onClick={() => {
      if (confirm(`End the test and send only variant ${variant} from now on? The other variants are paused, their results stay.`))
        run(() => promoteVariant(templateKey, variant));
    }}><Trophy />Use variant {variant} only</Button>
  );
}

export function AddVariantButton({ templateKey }: { templateKey: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => addVariant(templateKey))}><Plus />New challenger</Button>;
}

export function SequenceEditor({ id, steps, templateKeys }: { id: string; steps: { after_days: number; template_key: string }[]; templateKeys: string[] }) {
  const [rows, setRows] = useState(steps);
  const { pending, run } = useRun();
  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="w-16 text-ink-3">Step {i + 1}</span>
          <span>after</span>
          <Input type="number" min={1} max={60} value={s.after_days} className="w-20" aria-label={`Days for step ${i + 1}`}
            onChange={(e) => setRows(rows.map((r, k) => (k === i ? { ...r, after_days: Number(e.target.value) } : r)))} />
          <span>days without reply, send</span>
          <Select value={s.template_key} className="w-44" aria-label={`Template for step ${i + 1}`}
            onChange={(e) => setRows(rows.map((r, k) => (k === i ? { ...r, template_key: e.target.value } : r)))}>
            {templateKeys.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
          </Select>
          {rows.length > 1 ? <button className="text-[12.5px] text-ink-3 hover:text-danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>remove</button> : null}
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        {rows.length < 5 ? <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { after_days: (rows.at(-1)?.after_days ?? 0) + 7, template_key: templateKeys[0] }])}><Plus />Add step</Button> : null}
        <Button size="sm" className="ml-auto" disabled={pending} onClick={() => {
          const sorted = [...rows].sort((a, b) => a.after_days - b.after_days);
          setRows(sorted);
          run(() => updateSequence({ id, steps: sorted }));
        }}>Save schedule</Button>
      </div>
    </div>
  );
}
