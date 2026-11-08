import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type LeadCard, LeadBoard } from "@/components/outreach/lead-board";
import { NewOrganizationDialog } from "@/components/outreach/new-organization-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { getLeads, getOutreachTeam } from "@/lib/outreach/queries";

export const metadata: Metadata = { title: "Lead pipeline" };

export default async function LeadPipelinePage(props: PageProps<"/outreach/pipeline">) {
  const user = await requireRole("client_relations");
  const sp = await props.searchParams;
  const mine = sp.mine === "1";
  const overdue = sp.overdue === "1";
  const stale = sp.stale === "1";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const [leads, team] = await Promise.all([getLeads(user, { q, owner: mine ? user.id : undefined, overdue, stale }), getOutreachTeam(user)]);
  const cards: LeadCard[] = leads.map((l) => ({
    id: l.id, org: l.organization_name, owner: l.owner_name, stage: l.stage, fit: l.fit_score, win: l.win_probability,
    due: l.next_step_due, overdue: l.is_overdue, idle: l.days_since_activity, contact: l.primary_contact_name,
    alumni: l.primary_contact_is_alumni, nextStep: l.next_step,
  }));
  const chip = (label: string, href: string, active: boolean) => (
    <Link href={href}><Badge tone={active ? "brand" : "outline"} className="px-2.5 py-1 text-[12.5px]">{label}</Badge></Link>
  );
  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Lead pipeline"
        description="One open lead per organisation. Drag to update the stage; replies stop automatic follow-ups. Column totals show expected signed projects."
        actions={<NewOrganizationDialog trigger={<><Plus />New organisation</>} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form><Input name="q" defaultValue={q} placeholder="Search organisation, contact, sector…" className="w-72" /></form>
        {chip(`All · ${mine || overdue || stale ? "…" : leads.length}`, "/outreach/pipeline", !mine && !overdue && !stale)}
        {chip("My leads", "/outreach/pipeline?mine=1", mine && !overdue)}
        {chip("My overdue", "/outreach/pipeline?mine=1&overdue=1", overdue)}
        {chip("Stale > 14 days", "/outreach/pipeline?stale=1", stale)}
        <span className="ml-auto text-[12.5px] text-ink-3">{team.length} people in Client Relations</span>
      </div>
      <LeadBoard cards={cards} />
    </>
  );
}
