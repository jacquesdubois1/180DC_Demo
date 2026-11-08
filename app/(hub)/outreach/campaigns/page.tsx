import type { Metadata } from "next";
import { CampaignComposer } from "@/components/outreach/campaign-composer";
import { PageHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getLeads } from "@/lib/outreach/queries";

export const metadata: Metadata = { title: "Send e-mails" };

export default async function CampaignsPage() {
  const user = await requireRole("client_relations");
  const [leads, keys] = await Promise.all([
    getLeads(user, { stage: "new" }),
    withUser(user.id, async (sql) => (await sql<{ key: string }[]>`select distinct key from email_templates where department = 'client_relations' and is_active order by key`).map((r) => r.key)),
  ]);
  const rows = leads.filter((l) => !l.organization_do_not_contact)
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
    .map((l) => ({ id: l.id, org: l.organization_name, contact: l.primary_contact_name, email: l.primary_contact_email, fit: l.fit_score,
      reply: l.reply_probability, alumni: l.primary_contact_is_alumni, stage: l.stage, owner: l.owner_id === user.id ? "me" : l.owner_name }));
  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Send first e-mails"
        description="Thirty personal first e-mails used to take 40 minutes of copy-paste. Pick the leads, check the preview, queue - the Hub personalises, A/B-tests, throttles and schedules the follow-ups." />
      <CampaignComposer leads={rows} templateKeys={keys} />
    </>
  );
}
