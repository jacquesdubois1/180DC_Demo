import { ArrowLeft, ExternalLink, GraduationCap, Mail, MessageSquare, Phone, StickyNote, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AddContactDialog, DoNotContactButton, EmailComposer, InteractionForm, LeadEditor, StageControl, StopSequenceButton,
} from "@/components/outreach/lead-panels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { getLeadDetail, getOutreachTeam } from "@/lib/outreach/queries";
import { LEAD_META } from "@/lib/outreach/stages";
import { pct } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Lead" };

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  email_out: Mail, email_in: MessageSquare, call: Phone, meeting: Users, note: StickyNote, linkedin: ExternalLink,
};
const LABEL: Record<string, string> = { email_out: "E-mail sent", email_in: "Reply received", call: "Call", meeting: "Meeting", note: "Note", linkedin: "LinkedIn" };

export default async function LeadPage(props: PageProps<"/outreach/leads/[id]">) {
  const user = await requireRole("client_relations");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, team] = await Promise.all([getLeadDetail(user, id), getOutreachTeam(user)]);
  if (!d) notFound();
  const { lead, contacts, interactions, emails, history, enrollments, otherLeads } = d;
  const comp = lead.components as Record<string, number> | null;
  // one chronological feed: e-mails, calls and notes interleaved with stage changes
  const timeline = [
    ...interactions.map((item) => ({ kind: "interaction" as const, at: new Date(item.occurred_at).getTime(), key: item.id, item })),
    ...history.map((item, k) => ({ kind: "stage" as const, at: new Date(item.changed_at).getTime(), key: String(k), item })),
  ].sort((a, b) => b.at - a.at);

  return (
    <>
      <Link href="/outreach/pipeline" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Pipeline</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1">{lead.organization_type.replace("_", " ")} · {lead.sector ?? "sector unknown"} · {lead.city}</div>
          <h1 className="flex flex-wrap items-center gap-3 text-[26px] font-semibold tracking-tight">
            {lead.organization_name}
            <Badge tone={LEAD_META[lead.stage].tone}>{LEAD_META[lead.stage].label}</Badge>
            {lead.organization_do_not_contact ? <Badge tone="danger">do not contact</Badge> : null}
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="hover:text-brand">{lead.domain}</a> : "no website"} ·
            source: {lead.source.replace("_", " ")} · created {format(new Date(lead.created_at), "d MMM yyyy")} · last activity {formatDistanceToNow(new Date(lead.last_activity_at))} ago
          </p>
        </div>
        <div className="flex items-center gap-2"><StageControl leadId={lead.id} stage={lead.stage} /></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>Next step &amp; ownership</CardTitle><CardDescription>{lead.is_overdue ? "The next step is overdue." : "Every lead has one owner and one next step."}</CardDescription></div></CardHeader>
            <CardContent>
              <LeadEditor leadId={lead.id} team={team} initial={{ ownerId: lead.owner_id, nextStep: lead.next_step, nextStepDue: lead.next_step_due, priority: lead.priority, projectIdea: lead.project_idea }} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Write to {lead.primary_contact_name ?? "the organisation"}</CardTitle>
              <CardDescription>Sent from the Hub, logged automatically, with a personal opt-out link</CardDescription></div></CardHeader>
            <CardContent>
              {lead.organization_do_not_contact ? <p className="text-[13px] text-danger">This organisation asked not to be contacted.</p>
                : <EmailComposer leadId={lead.id} hasContact={!!lead.primary_contact_email} aiEnabled={env().AI_MODE !== "off"} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <InteractionForm leadId={lead.id} contacts={contacts.map((c) => ({ person_id: c.person_id, name: c.name }))} />
              <ol className="relative space-y-3 border-l border-line pl-5 text-[13.5px]">
                {timeline.map((e) => {
                  if (e.kind === "stage") {
                    const h = e.item;
                    return (
                      <li key={`h${e.key}`} className="text-[12.5px] text-ink-3">
                        <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-brand" />
                        Stage → {LEAD_META[h.to_status as keyof typeof LEAD_META]?.label ?? h.to_status} · {format(new Date(h.changed_at), "d MMM, HH:mm")}{h.by ? ` · ${h.by}` : ""}{h.note ? ` · ${h.note}` : ""}
                      </li>
                    );
                  }
                  const i = e.item;
                  const Icon = ICON[i.type] ?? StickyNote;
                  return (
                    <li key={i.id}>
                      <span className="absolute -left-[11px] flex size-5 items-center justify-center rounded-full border border-line bg-surface"><Icon className="size-3 text-ink-2" /></span>
                      <div className="text-[12px] text-ink-3">{LABEL[i.type]} · {format(new Date(i.occurred_at), "d MMM yyyy, HH:mm")}{i.author ? ` · ${i.author}` : ""}{i.person ? ` · with ${i.person}` : ""}
                        {i.template_variant ? <Badge tone="outline" className="ml-1.5">variant {i.template_variant}</Badge> : null}</div>
                      {i.subject ? <div className="font-medium">{i.subject}</div> : null}
                      {i.summary ? <div className="text-ink-2">{i.summary}</div> : null}
                    </li>
                  );
                })}
                {!timeline.length ? <li className="text-ink-3">No activity yet.</li> : null}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>Score</CardTitle><CardDescription>Fit with our ideal client profile, plus probabilities learned from past outreach</CardDescription></div></CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-surface-2 py-2"><div className="text-[20px] font-semibold tabular">{lead.fit_score?.toFixed(0) ?? "–"}</div><div className="text-[11.5px] text-ink-3">fit (band {String(comp?.band ?? "–")})</div></div>
                <div className="rounded-xl bg-surface-2 py-2"><div className="text-[20px] font-semibold tabular">{pct(lead.reply_probability)}</div><div className="text-[11.5px] text-ink-3">reply chance</div></div>
                <div className="rounded-xl bg-surface-2 py-2"><div className="text-[20px] font-semibold tabular">{pct(lead.win_probability)}</div><div className="text-[11.5px] text-ink-3">chance to sign</div></div>
              </div>
              {comp ? (
                <ul className="space-y-1.5 text-[13px]">
                  {(["sector", "org_type", "size", "location", "alumni"] as const).map((k) => (
                    <li key={k} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2">
                      <span className="capitalize text-ink-2">{k.replace("_", " ")}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${Number(comp[k] ?? 0) * 2.5}%` }} /></span>
                      <span className="text-right tabular text-ink-3">+{Number(comp[k] ?? 0).toFixed(0)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Contacts</CardTitle></div><AddContactDialog leadId={lead.id} organizationId={lead.organization_id} /></CardHeader>
            <CardContent className="space-y-2">
              {contacts.map((c) => (
                <div key={c.person_id} className="rounded-xl border border-line px-3 py-2.5 text-[13.5px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.is_primary ? <Badge tone="brand">primary</Badge> : null}
                    {c.is_esade_alumni ? <Badge tone="violet"><GraduationCap className="size-3" />Esade alumni</Badge> : null}
                    {c.do_not_contact ? <Badge tone="danger">opted out</Badge> : null}
                  </div>
                  <div className="text-[12.5px] text-ink-3">{c.title}{c.email ? ` · ${c.email}` : ""}</div>
                  {!c.do_not_contact ? <div className="mt-1"><DoNotContactButton personId={c.person_id} label="Do not contact" /></div> : null}
                </div>
              ))}
              {!contacts.length ? <p className="text-[13px] text-ink-3">No contact yet - find the decision maker.</p> : null}
            </CardContent>
          </Card>

          {enrollments.length ? (
            <Card>
              <CardHeader><div><CardTitle>Automatic follow-ups</CardTitle><CardDescription>Stop automatically when the lead replies</CardDescription></div></CardHeader>
              <CardContent className="space-y-2 text-[13.5px]">
                {enrollments.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.sequence}</span>
                    <Badge tone={e.status === "active" ? "info" : "neutral"}>{e.status}</Badge>
                    <span className="text-ink-3">{e.status === "active" ? `step ${e.step_index + 1}/${e.steps.length} on ${format(new Date(e.next_run_at), "d MMM")}` : e.stop_reason}</span>
                    {e.status === "active" ? <span className="ml-auto"><StopSequenceButton enrollmentId={e.id} /></span> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>E-mails</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-[13px]">
              {emails.map((e) => (
                <div key={e.id} className="flex items-center gap-2"><Mail className="size-3.5 text-ink-3" /><span className="flex-1 truncate">{e.subject}</span>
                  <Badge tone={e.status === "sent" ? "brand" : e.status === "queued" ? "info" : e.status === "failed" ? "danger" : "neutral"}>
                    {e.status === "queued" ? `queued ${format(new Date(e.scheduled_for), "d MMM HH:mm")}` : e.status}</Badge></div>
              ))}
              {!emails.length ? <p className="text-ink-3">No e-mails sent from the Hub yet.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Organisation</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-[13.5px] text-ink-2">
              <p>{lead.description ?? "No description."}</p>
              <p className="text-[12.5px] text-ink-3">Size {lead.size_band ?? "unknown"} · impact areas: {lead.impact_areas.join(", ") || "–"}</p>
              {otherLeads.length ? <p className="text-[12.5px] text-ink-3">Earlier leads: {otherLeads.map((o) => `${LEAD_META[o.stage as keyof typeof LEAD_META]?.label} (${format(new Date(o.created_at), "MMM yyyy")})`).join(", ")}</p> : null}
              {!lead.organization_do_not_contact ? <DoNotContactButton organizationId={lead.organization_id} label="Organisation: do not contact" /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
