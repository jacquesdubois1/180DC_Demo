import type { Metadata } from "next";
import { IcpEditor } from "@/components/outreach/icp-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { IcpInput } from "@/lib/outreach/actions";
import { computeModel } from "@/lib/outreach/score-job";
import { LEAD_META } from "@/lib/outreach/stages";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead scoring model" };

const STAGES = ["new", "contacted", "follow_up", "replied", "meeting", "proposal"] as const;

export default async function ScoringPage() {
  const user = await requireRole("client_relations");
  const data = await withUser(user.id, async (sql) => {
    const [icp] = await sql<{ name: string; criteria: IcpInput; created_at: string }[]>`
      select name, criteria, created_at from icp_profiles where is_active order by created_at desc limit 1`;
    const model = await computeModel(sql);
    return { icp, model };
  });
  if (!data.icp || !data.model) return <EmptyState title="No ideal client profile yet" />;
  const { model } = data;
  const bands = ["A", "B", "C", "D"].map((b) => {
    const pool = model.scored.filter((l) => l.band === b);
    const contacted = pool.filter((l) => l.contacted);
    return { band: b, leads: pool.length, contacted: contacted.length, replied: contacted.filter((l) => l.replied).length,
      won: pool.filter((l) => l.stage === "won").length, lift: model.rates.band[b] };
  });

  return (
    <>
      <PageHeader eyebrow="Client outreach" title="Lead scoring model"
        description="Two transparent parts: a fit score from the ideal client profile you set below, and probabilities the Hub learns from your own outreach history. No black box - every number can be explained to the team." />

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>1 · Fit (you decide)</CardTitle></CardHeader>
          <CardContent className="text-[13.5px] text-ink-2">Weighted match with the ideal client profile: sector, type, size, location and an Esade-alumni contact. Leads are grouped into bands A-D.</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>2 · Probabilities (learned)</CardTitle></CardHeader>
          <CardContent className="text-[13.5px] text-ink-2">
            P(sign | stage reached) and the lift of each fit band, from leads older than {model.matureDays} days ({model.cohortSize} leads). Silent leads count as not won,
            so the forecast is not inflated by survivorship; small groups are shrunk towards the average (empirical Bayes) and bands are kept monotone (isotonic regression).
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>3 · Used for</CardTitle></CardHeader>
          <CardContent className="text-[13.5px] text-ink-2">Ordering leads in the e-mail composer, the expected reply count of a campaign, and the forecast of signed projects against the consulting teams recruitment will staff.</CardContent>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Does the fit score predict outcomes?</CardTitle><CardDescription>Observed per band - all leads scored with the current profile</CardDescription></div></CardHeader>
          <Table>
            <THead><TR><TH>Band</TH><TH className="text-right">Leads</TH><TH className="text-right">Reply rate</TH><TH className="text-right">Signed</TH><TH className="text-right">Learned lift</TH></TR></THead>
            <TBody>
              {bands.filter((b) => b.leads).map((b) => (
                <TR key={b.band}>
                  <TD className="font-medium">{b.band}</TD>
                  <TD className="text-right tabular">{b.leads}</TD>
                  <TD className="text-right tabular">{b.contacted ? pct(b.replied / b.contacted) : "–"} <span className="text-ink-3">({b.replied}/{b.contacted})</span></TD>
                  <TD className="text-right tabular">{b.won}</TD>
                  <TD className="text-right tabular">×{b.lift.toFixed(2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Chance to sign by stage</CardTitle><CardDescription>Learned from history · overall {pct(model.rates.overall)} of mature leads were signed</CardDescription></div></CardHeader>
          <CardContent className="space-y-2">
            {STAGES.map((s) => {
              const v = model.rates.stage[s] ?? 0;
              return (
                <div key={s} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 text-[13px]">
                  <span className="text-ink-2">{LEAD_META[s].label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${Math.min(100, v * 100)}%` }} /></span>
                  <span className="text-right tabular">{pct(v)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-[15px] font-semibold">Ideal client profile · {data.icp.name}</h2>
      <IcpEditor initial={data.icp.criteria} name={data.icp.name} current={bands} />
    </>
  );
}
