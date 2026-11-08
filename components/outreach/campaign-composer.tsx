"use client";

import { Eye, GraduationCap, Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { previewCampaign, sendCampaign } from "@/lib/outreach/actions";

interface Lead { id: string; org: string; contact: string | null; email: string | null; fit: number | null; reply: number | null; alumni: boolean; stage: string; owner: string | null }

export function CampaignComposer({ leads, templateKeys }: { leads: Lead[]; templateKeys: string[] }) {
  const [minFit, setMinFit] = useState(0);
  const [onlyMine, setOnlyMine] = useState(false);
  const eligible = useMemo(() => leads.filter((l) => l.email && (l.fit ?? 0) >= minFit), [leads, minFit]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.slice(0, 20).map((l) => l.id)));
  const [templateKey, setTemplateKey] = useState(templateKeys.includes("first_touch") ? "first_touch" : templateKeys[0]);
  const [mode, setMode] = useState<"thompson" | "split" | "A" | "B">("thompson");
  const [perHour, setPerHour] = useState(20);
  const [enroll, setEnroll] = useState(true);
  const [preview, setPreview] = useState<{ variant: string; to: string; subject: string; body: string }[] | null>(null);
  const [pending, start] = useTransition();
  const shown = onlyMine ? eligible.filter((l) => l.owner === "me") : eligible;
  // what you see is what gets sent: hidden rows (filtered out) are never included
  const ids = [...selected].filter((id) => shown.some((l) => l.id === id));
  const expectedReplies = ids.reduce((s, id) => s + (leads.find((l) => l.id === id)?.reply ?? 0.15), 0);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <div><CardTitle>1 · Choose recipients</CardTitle><CardDescription>Leads not contacted yet, sorted by fit. Opted-out contacts are excluded automatically.</CardDescription></div>
          <div className="flex items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />mine</label>
            <span className="text-ink-3">min fit</span>
            <Input type="number" value={minFit} min={0} max={100} onChange={(e) => setMinFit(Number(e.target.value))} className="w-20" />
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="mb-2 flex items-center gap-3 text-[13px]">
            <button className="text-brand hover:underline" onClick={() => setSelected(new Set(shown.map((l) => l.id)))}>Select all ({shown.length})</button>
            <button className="text-ink-3 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
            <span className="ml-auto text-ink-3">{ids.length} selected</span>
          </div>
          <ul className="max-h-[520px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {shown.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.5px] hover:bg-surface-2">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={(e) => {
                    const n = new Set(selected);
                    if (e.target.checked) n.add(l.id); else n.delete(l.id);
                    setSelected(n);
                  }} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{l.org}</span>
                    <span className="block truncate text-[12px] text-ink-3">{l.contact} · {l.email}</span></span>
                  {l.alumni ? <GraduationCap className="size-4 text-brand" aria-label="Esade alumni" /> : null}
                  <span className="w-10 text-right text-[12px] tabular text-ink-2" title="fit score">{l.fit?.toFixed(0)}</span>
                </label>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader><div><CardTitle>2 · Message &amp; sending</CardTitle><CardDescription>Each e-mail is personalised (name, organisation, sector, project idea) and sent from your name</CardDescription></div></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Template">
              <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>{templateKeys.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</Select>
            </Field>
            <Field label="Variant allocation" hint={mode === "thompson" ? "Thompson sampling: the variant with more replies so far gets more sends, while the test keeps learning." : undefined}>
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="thompson">Adaptive A/B (Thompson sampling)</option><option value="split">50/50 split</option>
                <option value="A">Only variant A</option><option value="B">Only variant B</option>
              </Select>
            </Field>
            <Field label="Sending speed" hint="Spreading sends protects deliverability; the outbox respects a daily limit per sender.">
              <Select value={perHour} onChange={(e) => setPerHour(Number(e.target.value))}>
                {[10, 20, 40, 60].map((n) => <option key={n} value={n}>{n} e-mails per hour</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={enroll} onChange={(e) => setEnroll(e.target.checked)} />
              Automatic follow-ups after 5 and 12 days if there is no reply</label>
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              Expected replies: <b className="tabular">{expectedReplies.toFixed(1)}</b> from {ids.length} e-mails (based on learned reply rates)
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={!ids.length || pending} onClick={() => start(async () => {
                const r = await previewCampaign(ids, templateKey);
                if (r.ok && r.data) setPreview(r.data); else if (!r.ok) toast.error(r.error);
              })}><Eye />Preview</Button>
              <Button disabled={!ids.length || pending} onClick={() => start(async () => {
                if (!confirm(`Queue ${ids.length} personalised e-mails?`)) return;
                const r = await sendCampaign({ leadIds: ids, templateKey, mode, perHour, enrollSequence: enroll, campaign: `Campaign ${new Date().toLocaleDateString("en-GB")}` });
                if (r.ok) { toast.success(r.message); setSelected(new Set()); setPreview(null); } else toast.error(r.error);
              })}><Send />Queue {ids.length} e-mails</Button>
            </div>
          </CardContent>
        </Card>
        {preview ? (
          <Card>
            <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {preview.map((p, i) => (
                <div key={i} className="rounded-xl border border-line p-3 text-[13px]">
                  <div className="mb-1 flex items-center gap-2 text-ink-3">To {p.to}<Badge tone="violet">variant {p.variant}</Badge></div>
                  <div className="font-medium">{p.subject}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-ink-2">{p.body}</pre>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
