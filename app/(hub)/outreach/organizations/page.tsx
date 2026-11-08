import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewOrganizationDialog } from "@/components/outreach/new-organization-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { LEAD_META, type LeadStage } from "@/lib/outreach/stages";

export const metadata: Metadata = { title: "Organisations" };

export default async function OrganizationsPage(props: PageProps<"/outreach/organizations">) {
  const user = await requireRole("client_relations");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim() : null;
  const type = typeof sp.type === "string" && sp.type ? sp.type : null;
  const rows = await withUser(user.id, (sql) => sql<{ id: string; name: string; type: string; sector: string | null; city: string | null; size_band: string | null;
    domain: string | null; do_not_contact: boolean; contacts: number; lead_id: string | null; lead_stage: LeadStage | null; fit: number | null; similarity: number | null }[]>`
    select o.id, o.name, o.type::text, o.sector, o.city, o.size_band, o.domain::text, o.do_not_contact,
           (select count(*)::int from person_roles pr where pr.organization_id = o.id and pr.role = 'contact') as contacts,
           l.id as lead_id, l.stage as lead_stage, s.fit_score as fit,
           case when ${q}::text is null then null else extensions.similarity(o.normalized_name, app.normalize_org_name(${q})) end as similarity
    from organizations o
    left join lateral (select id, stage from leads where organization_id = o.id order by created_at desc limit 1) l on true
    left join lead_scores s on s.lead_id = l.id
    where (${type}::text is null or o.type::text = ${type})
      and (${q}::text is null or o.normalized_name ilike '%' || app.normalize_org_name(${q}) || '%'
           or extensions.similarity(o.normalized_name, app.normalize_org_name(${q})) > 0.3 or o.domain ilike '%' || ${q} || '%')
    order by similarity desc nulls last, o.name limit 300`);

  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Organisations" description="Every organisation exists once (de-duplicated by domain and fuzzy name matching), with its full contact history."
        actions={<NewOrganizationDialog trigger={<><Plus />New organisation</>} />} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search - fuzzy, e.g. “ecoalph” finds “Ecoalf”" className="w-80" />
        <Select name="type" defaultValue={type ?? ""} className="w-48">
          <option value="">All types</option>
          {["startup", "social_enterprise", "ngo", "foundation", "company", "public_sector"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
        </Select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <Card>
        <Table>
          <THead><TR><TH>Organisation</TH><TH>Type</TH><TH>Sector · city</TH><TH className="text-right">Contacts</TH><TH>Lead</TH><TH className="text-right">Fit</TH></TR></THead>
          <TBody>
            {rows.map((o) => (
              <TR key={o.id} className="hover:bg-surface-2/60">
                <TD>
                  {o.lead_id ? <Link href={`/outreach/leads/${o.lead_id}`} className="font-medium hover:text-brand">{o.name}</Link> : <span className="font-medium">{o.name}</span>}
                  <div className="text-[12px] text-ink-3">{o.domain ?? "no website"}{o.do_not_contact ? " · do not contact" : ""}</div>
                </TD>
                <TD className="text-ink-2">{o.type.replace("_", " ")}</TD>
                <TD className="text-ink-2">{o.sector ?? "–"} · {o.city ?? "–"}</TD>
                <TD className="text-right tabular">{o.contacts}</TD>
                <TD>{o.lead_stage ? <Badge tone={LEAD_META[o.lead_stage].tone}>{LEAD_META[o.lead_stage].label}</Badge> : <span className="text-[12px] text-ink-3">no lead</span>}</TD>
                <TD className="text-right tabular">{o.fit?.toFixed(0) ?? "–"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
