import type { Metadata } from "next";
import Link from "next/link";
import { CycleSwitcher } from "@/components/hr/cycle-switcher";
import { type BoardCard, PipelineBoard } from "@/components/hr/pipeline-board";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { getApplications, getPositions, resolveCycle } from "@/lib/hr/queries";

export const metadata: Metadata = { title: "Recruitment pipeline" };

export default async function PipelinePage(props: PageProps<"/hr/pipeline">) {
  const user = await requireRole("hr");
  const sp = await props.searchParams;
  const { cycle, cycles } = await resolveCycle(user, sp.cycle);
  const position = typeof sp.position === "string" ? sp.position : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const [apps, positions] = await Promise.all([getApplications(user, cycle.id, { position, q }), getPositions(user, cycle.id)]);
  const cards: BoardCard[] = apps.map((a) => ({
    id: a.id, alias: a.alias, name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || a.alias, position: a.position_name,
    stage: a.stage, avg: a.avg_score, submitted: a.reviews_submitted, assigned: a.reviewers_assigned,
    yes: a.yes_votes, maybe: a.maybe_votes, no: a.no_votes, hasCv: !!a.cv_file_id,
    daysInStage: a.days_in_stage,
  }));
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams({ cycle: cycle.slug, ...(position ? { position } : {}), ...(q ? { q } : {}) });
    for (const [k, v] of Object.entries(p)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    return `?${u.toString()}`;
  };

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Pipeline"
        description="Drag a candidate to the next stage. Every move is logged; decisions ask for a reason and prepare the e-mail for review."
        actions={<CycleSwitcher cycles={cycles} current={cycle.slug} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2">
          <input type="hidden" name="cycle" value={cycle.slug} />
          {position ? <input type="hidden" name="position" value={position} /> : null}
          <Input name="q" defaultValue={q} placeholder="Search name, e-mail, university…" className="w-72" />
        </form>
        <Link href={qs({ position: undefined })}><Badge tone={!position ? "brand" : "outline"} className="px-2.5 py-1 text-[12.5px]">All tracks · {apps.length}</Badge></Link>
        {positions.map((p) => (
          <Link key={p.id} href={qs({ position: p.slug })}>
            <Badge tone={position === p.slug ? "brand" : "outline"} className="px-2.5 py-1 text-[12.5px]">{p.name}</Badge>
          </Link>
        ))}
      </div>
      <PipelineBoard cards={cards} />
    </>
  );
}
