import type { Metadata } from "next";
import Link from "next/link";
import { ImportUpload } from "@/components/outreach/import-upload";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Import prospects" };

export default async function ImportPage() {
  const user = await requireRole("client_relations");
  const imports = await withUser(user.id, (sql) => sql<{ id: string; filename: string; status: string; created_at: string; by: string | null;
    stats: { rows?: number; new?: number; duplicate?: number; possible_duplicate?: number; committed?: { leads_created: number } } }[]>`
    select i.id, i.filename, i.status, i.created_at, i.stats, (select display_name from app_users u where u.id = i.created_by) as by
    from prospect_imports i order by i.created_at desc limit 50`);
  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Import prospects"
        description="Bring in lists from Excel, monday.com or LinkedIn exports. Columns are recognised automatically (English, Spanish, Catalan); every row is checked against the CRM before anything is created." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader><div><CardTitle>Upload a list</CardTitle><CardDescription>Nothing is saved to the CRM until you review and confirm</CardDescription></div></CardHeader>
          <CardContent><ImportUpload /></CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>How duplicates are found</CardTitle></div></CardHeader>
          <CardContent className="space-y-2 text-[13.5px] text-ink-2">
            <p><b className="text-ink">Same website or company e-mail domain</b> → duplicate, the contact is added to the existing organisation.</p>
            <p><b className="text-ink">Same name after normalisation</b> (accents, “S.L.”, “Fundació”…) → duplicate.</p>
            <p><b className="text-ink">Similar name</b> (Jaro-Winkler ≥ 0.88, e.g. “Ecoalf” vs “Eco-Alf SL”) → possible duplicate: a person decides.</p>
            <p><b className="text-ink">Opted-out</b> organisations and addresses are skipped automatically.</p>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader><CardTitle>Previous imports</CardTitle></CardHeader>
        <Table>
          <THead><TR><TH>File</TH><TH>Uploaded</TH><TH className="text-right">Rows</TH><TH className="text-right">New</TH><TH className="text-right">Duplicates</TH><TH>Status</TH></TR></THead>
          <TBody>
            {imports.map((i) => (
              <TR key={i.id}>
                <TD><Link href={`/outreach/import/${i.id}`} className="font-medium hover:text-brand">{i.filename}</Link></TD>
                <TD className="text-ink-2">{format(new Date(i.created_at), "d MMM yyyy, HH:mm")}{i.by ? ` · ${i.by}` : ""}</TD>
                <TD className="text-right tabular">{i.stats.rows ?? "–"}</TD>
                <TD className="text-right tabular">{i.stats.new ?? "–"}</TD>
                <TD className="text-right tabular">{(i.stats.duplicate ?? 0) + (i.stats.possible_duplicate ?? 0)}</TD>
                <TD>{i.status === "committed" ? <Badge tone="brand">imported · {i.stats.committed?.leads_created ?? 0} leads</Badge>
                  : i.status === "review" ? <Badge tone="warn">waiting for review</Badge> : <Badge>discarded</Badge>}</TD>
              </TR>
            ))}
            {!imports.length ? <TR><TD colSpan={6} className="py-6 text-center text-ink-3">No imports yet.</TD></TR> : null}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
