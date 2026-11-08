import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MappingEditor, type ReviewRow, ReviewTable } from "@/components/outreach/import-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ColumnMapping } from "@/lib/outreach/import-map";
import { getOutreachTeam } from "@/lib/outreach/queries";

export const metadata: Metadata = { title: "Review import" };

export default async function ImportReviewPage(props: PageProps<"/outreach/import/[id]">) {
  const user = await requireRole("client_relations");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [data, team] = await Promise.all([
    withUser(user.id, async (sql) => {
      const [imp] = await sql<{ id: string; filename: string; status: string; created_at: string;
        column_mapping: { mapping: ColumnMapping; headers: string[] }; stats: Record<string, number | boolean | Record<string, number>> }[]>`
        select id, filename, status, created_at, column_mapping, stats from prospect_imports where id = ${id}`;
      if (!imp) return null;
      const rows = await sql<ReviewRow[]>`
        select r.id, r.row_number, r.match_status, r.decision, r.match_reason, r.similarity, r.normalized, o.name as matched_name
        from prospect_import_rows r left join organizations o on o.id = r.matched_organization_id
        where r.import_id = ${id} order by r.row_number`;
      return { imp, rows };
    }),
    getOutreachTeam(user),
  ]);
  if (!data) notFound();
  const { imp, rows } = data;
  const st = imp.stats as Record<string, number>;
  const committed = imp.stats.committed as Record<string, number> | undefined;
  const editable = imp.status === "review";

  return (
    <>
      <Link href="/outreach/import" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Imports</Link>
      <PageHeader eyebrow="Import review" title={imp.filename}
        description={editable ? "Check the result, decide the possible duplicates, then import. Nothing has been written to the CRM yet." : undefined}
        actions={<Badge tone={imp.status === "committed" ? "brand" : imp.status === "review" ? "warn" : "neutral"}>{imp.status === "review" ? "waiting for review" : imp.status}</Badge>} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Rows" value={st.rows ?? rows.length} />
        <Stat label="New organisations" value={st.new ?? 0} />
        <Stat label="Already in CRM" value={st.duplicate ?? 0} />
        <Stat label="Possible duplicates" value={st.possible_duplicate ?? 0} />
        <Stat label="Invalid / repeated" value={(st.invalid ?? 0) + (st.in_file_duplicate ?? 0)} />
      </div>
      {st.truncated ? <p className="mb-4 text-[13px] text-warn">Only the first 2,000 rows were read. Split larger files.</p> : null}
      {committed ? (
        <Card className="mb-5">
          <CardContent className="py-4 text-[13.5px] text-ink-2">
            Imported: <b className="text-ink">{committed.leads_created}</b> leads, <b className="text-ink">{committed.contacts_added}</b> contacts,
            {" "}<b className="text-ink">{committed.organizations_created}</b> new organisations ({committed.organizations_updated} existing ones completed), {committed.skipped} rows skipped.
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader><div><CardTitle>Columns</CardTitle><CardDescription>Recognised automatically - correct a column if needed and the rows are checked again</CardDescription></div></CardHeader>
        <CardContent><MappingEditor importId={imp.id} headers={imp.column_mapping.headers ?? []} mapping={imp.column_mapping.mapping ?? {}} disabled={!editable} /></CardContent>
      </Card>

      <ReviewTable importId={imp.id} rows={rows} team={team} editable={editable} />
    </>
  );
}
