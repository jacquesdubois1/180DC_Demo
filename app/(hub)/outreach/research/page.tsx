import type { Metadata } from "next";
import { ResearchForm, SuggestionCard, type SuggestionItem } from "@/components/outreach/research";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { aiMode } from "@/lib/ai/client";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export const metadata: Metadata = { title: "AI lead research" };

export default async function ResearchPage() {
  const user = await requireRole("client_relations");
  const data = await withUser(user.id, async (sql) => ({
    icp: (await sql<{ criteria: { sectors: Record<string, number> } }[]>`select criteria from icp_profiles where is_active order by created_at desc limit 1`)[0],
    suggestions: await sql<SuggestionItem[]>`
      select s.id, s.name, s.website, s.org_type::text, s.sector, s.city, s.rationale, s.sources, s.suggested_contact_role, s.fit_score, s.status,
             s.organization_id, (select l.id from leads l where l.organization_id = s.organization_id order by l.created_at desc limit 1) as lead_id
      from lead_suggestions s order by (s.status = 'pending') desc, s.created_at desc limit 60`,
    runs: await sql<{ id: string; status: string; input_summary: string | null; cost_usd: number | null; created_at: string; by: string | null; model: string }[]>`
      select r.id, r.status, r.input_summary, r.cost_usd, r.created_at, r.model, (select display_name from app_users u where u.id = r.created_by) as by
      from ai_runs r where r.kind = 'lead_research' order by r.created_at desc limit 8`,
    spend: (await sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float as usd from ai_runs where created_at > date_trunc('month', now())`)[0]?.usd ?? 0,
  }));
  const sectors = Object.entries(data.icp?.criteria.sectors ?? {}).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const pending = data.suggestions.filter((s) => s.status === "pending");
  const decided = data.suggestions.filter((s) => s.status !== "pending");

  return (
    <>
      <PageHeader eyebrow="Client outreach" title="AI lead research"
        description="Describe the organisations you are looking for; Claude searches the web and proposes candidates with sources. A person always checks and accepts - nothing is added or e-mailed automatically." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><div><CardTitle>What are you looking for?</CardTitle><CardDescription>Sectors come from your ideal client profile</CardDescription></div></CardHeader>
          <CardContent><ResearchForm sectors={sectors.length ? sectors : ["Education", "Circular economy"]} mode={aiMode()} /></CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Recent searches</CardTitle><CardDescription>AI spend this month: ${data.spend.toFixed(2)} · every call is logged with model, tokens and cost</CardDescription></div></CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            {data.runs.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
                <div className="min-w-0"><div className="truncate">{r.input_summary}</div>
                  <div className="text-[12px] text-ink-3">{format(new Date(r.created_at), "d MMM, HH:mm")}{r.by ? ` · ${r.by}` : ""} · {r.status}</div></div>
                <span className="shrink-0 tabular text-ink-3">{r.cost_usd !== null ? `$${Number(r.cost_usd).toFixed(3)}` : "–"}</span>
              </div>
            ))}
            {!data.runs.length ? <p className="text-ink-3">No searches yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-[15px] font-semibold">To review · {pending.length}</h2>
      {pending.length ? <div className="grid gap-3 lg:grid-cols-2">{pending.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
        : <EmptyState title="Nothing to review">Run a search to get new suggestions.</EmptyState>}
      {decided.length ? (
        <>
          <h2 className="mb-3 mt-8 text-[15px] font-semibold text-ink-2">Decided</h2>
          <div className="grid gap-3 lg:grid-cols-2">{decided.slice(0, 20).map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
        </>
      ) : null}
    </>
  );
}
