import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { StageBadge } from "@/components/hr/stage-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { getApplications, getPositions, resolveCycle } from "@/lib/hr/queries";
import { APPLICATION_STAGES, STAGE_META } from "@/lib/hr/stages";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage(props: PageProps<"/hr/applications">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const position = typeof sp.position === "string" && sp.position ? sp.position : undefined;
  const stage = typeof sp.stage === "string" && sp.stage ? sp.stage : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const sort = typeof sp.sort === "string" ? sp.sort : "date";
  const [apps, positions] = await Promise.all([getApplications(user, cycle.id, { position, stage, q }), getPositions(user, cycle.id)]);
  const sorted = [...apps].sort((a, b) => sort === "score" ? (b.avg_score ?? -1) - (a.avg_score ?? -1)
    : sort === "name" ? `${a.last_name}`.localeCompare(`${b.last_name}`) : +new Date(b.submitted_at) - +new Date(a.submitted_at));
  const exportHref = `/api/hr/export?${new URLSearchParams({ cycle: cycle.slug, ...(position ? { position } : {}), ...(stage ? { stage } : {}), ...(q ? { q } : {}) })}`;

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Applications"
        description={`${apps.length} application(s) match your filters.`}
        actions={<>
          <CycleSwitcher cycles={cycles} current={cycle.slug} />
          <Button asChild variant="outline"><a href={exportHref}><Download />Export CSV</a></Button>
        </>} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="cycle" value={cycle.slug} />
        <Input name="q" defaultValue={q} placeholder="Search name, e-mail, university, alias…" className="w-72" />
        <Select name="position" defaultValue={position ?? ""} className="w-48">
          <option value="">All tracks</option>
          {positions.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </Select>
        <Select name="stage" defaultValue={stage ?? ""} className="w-44">
          <option value="">All stages</option>
          {APPLICATION_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </Select>
        <Select name="sort" defaultValue={sort} className="w-44">
          <option value="date">Newest first</option>
          <option value="score">Highest score</option>
          <option value="name">Last name</option>
        </Select>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
      <Card>
        {sorted.length ? (
          <Table>
            <THead>
              <TR><TH>Candidate</TH><TH>Track</TH><TH>Stage</TH><TH>University · program</TH><TH className="text-right">Score</TH><TH className="text-right">Reviews</TH><TH>Submitted</TH><TH /></TR>
            </THead>
            <TBody>
              {sorted.map((a) => (
                <TR key={a.id} className="hover:bg-surface-2/60">
                  <TD>
                    <Link href={`/hr/applications/${a.id}`} className="font-medium hover:text-brand">{a.first_name} {a.last_name}</Link>
                    <div className="text-[12px] text-ink-3">{a.email} · <span className="font-mono">{a.alias}</span></div>
                  </TD>
                  <TD>{a.position_name}</TD>
                  <TD><StageBadge stage={a.stage} /></TD>
                  <TD className="max-w-64"><div className="truncate">{a.university}</div><div className="truncate text-[12px] text-ink-3">{a.degree_program} · {a.study_year}</div></TD>
                  <TD className="text-right font-semibold tabular">{a.avg_score?.toFixed(2) ?? "–"}</TD>
                  <TD className="text-right tabular text-ink-2">{a.reviews_submitted}/{a.reviewers_assigned}</TD>
                  <TD className="whitespace-nowrap text-ink-3">{format(new Date(a.submitted_at), "d MMM")}</TD>
                  <TD>{a.cv_file_id ? <FileText className="size-4 text-ink-3" aria-label="CV attached" /> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <div className="p-6"><EmptyState title="No applications match">Try removing a filter.</EmptyState></div>}
      </Card>
    </>
  );
}
