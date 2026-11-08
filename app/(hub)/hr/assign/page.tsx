import type { Metadata } from "next";
import { AssignmentPlanner } from "@/components/hr/assignment-planner";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPositions, getReviewerPool, resolveCycle } from "@/lib/hr/queries";

export const metadata: Metadata = { title: "Assign reviewers" };

export default async function AssignPage(props: PageProps<"/hr/assign">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const [pool, positions, needs] = await Promise.all([
    getReviewerPool(user, cycle.id),
    getPositions(user, cycle.id),
    withUser(user.id, async (sql) => {
      const [n] = await sql<{ screening: number; interview: number; conflicts: number }[]>`
        select
          (select count(*)::int from applications a where a.cycle_id = ${cycle.id} and a.stage in ('received','screening') and a.anonymized_at is null
             and (select count(*) from application_reviewers ar where ar.application_id = a.id and ar.stage = 'screening') < ${cycle.reviewers_per_application}) as screening,
          (select count(*)::int from applications a where a.cycle_id = ${cycle.id} and a.stage = 'interview'
             and (select count(*) from application_reviewers ar where ar.application_id = a.id and ar.stage = 'interview') < ${cycle.reviewers_per_application}) as interview,
          (select count(*)::int from review_conflicts c join applications a on a.id = c.application_id where a.cycle_id = ${cycle.id}) as conflicts`;
      return n;
    }),
  ]);
  const posName = new Map(positions.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Assign reviewers"
        description={`Every application needs ${cycle.reviewers_per_application} independent reviewers. The optimiser proposes a plan in seconds; nothing changes until you apply it.`}
        actions={<CycleSwitcher cycles={cycles} current={cycle.slug} />} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AssignmentPlanner cycleId={cycle.id} needs={{ screening: needs.screening, interview: needs.interview }} />
        <Card className="self-start">
          <CardHeader><div><CardTitle>Reviewer pool</CardTitle><CardDescription>{needs.conflicts} declared conflict(s) of interest are excluded automatically</CardDescription></div></CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead><TR><TH>Reviewer</TH><TH>Knows tracks</TH><TH className="text-right">Open / capacity</TH></TR></THead>
              <TBody>
                {pool.map((r) => (
                  <TR key={r.user_id}>
                    <TD><div className="font-medium">{r.display_name}</div><div className="text-[12px] text-ink-3">{r.is_senior ? "senior" : "reviewer"}</div></TD>
                    <TD className="text-[12.5px] text-ink-2">{r.position_ids.map((id) => posName.get(id)).filter(Boolean).join(", ") || "–"}</TD>
                    <TD className="text-right tabular">{r.open}/{r.max_reviews}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
