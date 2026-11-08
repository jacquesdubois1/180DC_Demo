"use client";

import { Ban, Send, Sparkles, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addContact, logInteraction, moveLead, setDoNotContact, stopSequence, updateLead } from "@/lib/outreach/actions";
import { draftEmail, sendLeadEmail } from "@/lib/outreach/ai-actions";
import { CLOSING, LEAD_META, LEAD_STAGES, type LeadStage } from "@/lib/outreach/stages";

type Res = { ok: boolean; message?: string; error?: string };
function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(r.message ?? "Saved"); after?.(); } else toast.error(r.error);
  });
  return { pending, run };
}

export function StageControl({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const { pending, run } = useRun();
  const [target, setTarget] = useState<LeadStage | null>(null);
  const [reason, setReason] = useState("");
  return (
    <>
      <Select value={stage} disabled={pending} className="w-48" aria-label="Stage"
        onChange={(e) => {
          const to = e.target.value as LeadStage;
          if (CLOSING.includes(to)) { setReason(""); setTarget(to); } else run(() => moveLead(leadId, to));
        }}>
        {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_META[s].label}</option>)}
      </Select>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        {target ? (
          <DialogContent title={`Close as “${LEAD_META[target].label}”`} description="The reason helps us learn which organisations to approach next time.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button disabled={reason.trim().length < 3 || pending} onClick={() => run(() => moveLead(leadId, target, reason), () => setTarget(null))}>Confirm</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function LeadEditor({ leadId, initial, team }: {
  leadId: string; team: { id: string; display_name: string }[];
  initial: { ownerId: string | null; nextStep: string | null; nextStepDue: string | null; priority: number; projectIdea: string | null };
}) {
  const [v, setV] = useState({ ...initial, nextStep: initial.nextStep ?? "", nextStepDue: initial.nextStepDue ?? "", projectIdea: initial.projectIdea ?? "" });
  const { pending, run } = useRun();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Owner">
        <Select value={v.ownerId ?? ""} onChange={(e) => setV({ ...v, ownerId: e.target.value || null })}>
          <option value="">Unassigned</option>{team.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </Select>
      </Field>
      <Field label="Priority">
        <Select value={v.priority} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })}>
          <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
        </Select>
      </Field>
      <Field label="Next step" className="sm:col-span-2"><Input value={v.nextStep} onChange={(e) => setV({ ...v, nextStep: e.target.value })} placeholder="e.g. Follow up on scope" /></Field>
      <Field label="Due"><Input type="date" value={v.nextStepDue} onChange={(e) => setV({ ...v, nextStepDue: e.target.value })} /></Field>
      <Field label="Project idea"><Input value={v.projectIdea} onChange={(e) => setV({ ...v, projectIdea: e.target.value })} /></Field>
      <div className="flex justify-end sm:col-span-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => updateLead(leadId, {
          ownerId: v.ownerId, nextStep: v.nextStep || null, nextStepDue: v.nextStepDue || null, priority: v.priority, projectIdea: v.projectIdea || null,
        }))}>Save</Button>
      </div>
    </div>
  );
}

export function InteractionForm({ leadId, contacts }: { leadId: string; contacts: { person_id: string; name: string }[] }) {
  const [v, setV] = useState({ type: "call", summary: "", personId: contacts[0]?.person_id ?? "", nextStep: "", nextStepDue: "" });
  const { pending, run } = useRun();
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className="w-44" aria-label="Type">
          <option value="call">Call</option><option value="meeting">Meeting</option><option value="email_in">Reply received</option>
          <option value="email_out">E-mail sent elsewhere</option><option value="linkedin">LinkedIn</option><option value="note">Note</option>
        </Select>
        {contacts.length ? (
          <Select value={v.personId} onChange={(e) => setV({ ...v, personId: e.target.value })} className="w-56" aria-label="Contact">
            {contacts.map((c) => <option key={c.person_id} value={c.person_id}>{c.name}</option>)}
          </Select>
        ) : null}
      </div>
      <Textarea value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} placeholder="What happened? Key facts, objections, agreements…" className="min-h-20" />
      <div className="flex flex-wrap items-center gap-2">
        <Input value={v.nextStep} onChange={(e) => setV({ ...v, nextStep: e.target.value })} placeholder="Next step (optional)" className="min-w-48 flex-1" />
        <Input type="date" value={v.nextStepDue} onChange={(e) => setV({ ...v, nextStepDue: e.target.value })} className="w-40" aria-label="Next step due" />
        <Button size="sm" disabled={pending || v.summary.trim().length < 2} onClick={() => run(() => logInteraction({
          leadId, type: v.type as never, summary: v.summary, personId: v.personId || null, nextStep: v.nextStep || undefined, nextStepDue: v.nextStepDue || undefined,
        }), () => setV({ ...v, summary: "", nextStep: "", nextStepDue: "" }))}>Log</Button>
      </div>
    </div>
  );
}

export function AddContactDialog({ leadId, organizationId }: { leadId: string; organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", title: "", linkedinUrl: "", isAlumni: false, primary: false });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus />Add contact</Button></DialogTrigger>
      <DialogContent title="Add contact" description="Business contact details only. The person can opt out at any time.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name"><Input value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} /></Field>
          <Field label="Last name"><Input value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} /></Field>
          <Field label="E-mail" className="sm:col-span-2"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Role"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Founder & CEO" /></Field>
          <Field label="LinkedIn"><Input value={v.linkedinUrl} onChange={(e) => setV({ ...v, linkedinUrl: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.isAlumni} onChange={(e) => setV({ ...v, isAlumni: e.target.checked })} />Esade alumni</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.primary} onChange={(e) => setV({ ...v, primary: e.target.checked })} />Primary contact for this lead</label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !v.firstName} onClick={() => run(() => addContact({ organizationId, leadId, ...v }), () => setOpen(false))}>Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DoNotContactButton({ personId, organizationId, label }: { personId?: string; organizationId?: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" className="text-danger" disabled={pending}
      onClick={() => { if (confirm(`${label}? Queued e-mails are cancelled and no one will contact them again.`)) run(() => setDoNotContact({ personId, organizationId }, "Marked in lead page")); }}>
      <Ban />{label}
    </Button>
  );
}

export function StopSequenceButton({ enrollmentId }: { enrollmentId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => stopSequence(enrollmentId))}>Stop follow-ups</Button>;
}

export function EmailComposer({ leadId, hasContact, aiEnabled }: { leadId: string; hasContact: boolean; aiEnabled: boolean }) {
  const [draft, setDraft] = useState<{ subject: string; body: string; to: string | null } | null>(null);
  const [drafting, startDraft] = useTransition();
  const { pending, run } = useRun();
  if (!hasContact) return <p className="text-[13px] text-ink-3">Add a primary contact with an e-mail address to write to this organisation.</p>;
  if (!draft) {
    return (
      <div className="flex flex-wrap gap-2">
        {aiEnabled ? (
          <Button variant="secondary" disabled={drafting} onClick={() => startDraft(async () => {
            const r = await draftEmail(leadId);
            if (r.ok && r.data) setDraft(r.data); else if (!r.ok) toast.error(r.error);
          })}><Sparkles />{drafting ? "Drafting…" : "Draft personalised e-mail with AI"}</Button>
        ) : null}
        <Button variant="outline" onClick={() => setDraft({ subject: "", body: "\n\n{{unsubscribe_link}}", to: null })}>Write manually</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {draft.to ? <div className="text-[13px] text-ink-3">To {draft.to} · review before sending</div> : null}
      <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject" aria-label="Subject" />
      <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="min-h-56" aria-label="Body" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
        <Button disabled={pending} onClick={() => run(() => sendLeadEmail(leadId, draft.subject, draft.body), () => setDraft(null))}><Send />Send</Button>
      </div>
    </div>
  );
}
