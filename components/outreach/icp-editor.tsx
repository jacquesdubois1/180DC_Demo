"use client";

import { Eye, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { type IcpInput, previewIcp, saveIcp } from "@/lib/outreach/actions";

type Group = "sectors" | "org_types" | "size_bands" | "cities";
const GROUPS: { key: Group; label: string }[] = [
  { key: "sectors", label: "Sectors" }, { key: "org_types", label: "Organisation types" },
  { key: "size_bands", label: "Team size" }, { key: "cities", label: "Location" },
];
const WEIGHTS: { key: keyof IcpInput["weights"]; label: string }[] = [
  { key: "sector", label: "Sector" }, { key: "org_type", label: "Organisation type" }, { key: "size", label: "Team size" },
  { key: "location", label: "Location" }, { key: "alumni", label: "Esade-alumni contact" },
];

interface BandRow { band: string; leads: number; contacted: number; replied: number; won: number; lift: number }

export function IcpEditor({ initial, name, current }: { initial: IcpInput; name: string; current: BandRow[] }) {
  const [icp, setIcp] = useState<IcpInput>(initial);
  const [preview, setPreview] = useState<BandRow[] | null>(null);
  const [pending, start] = useTransition();
  const total = Object.values(icp.weights).reduce((a, b) => a + b, 0) || 1;
  const pctOf = (v: number) => Math.round(v * 100);
  const setWeight = (k: keyof IcpInput["weights"], v: number) => setIcp({ ...icp, weights: { ...icp.weights, [k]: Math.max(0, Math.min(1, v / 100)) } });
  const setValue = (g: Group, k: string, v: number) => setIcp({ ...icp, [g]: { ...icp[g], [k]: Math.max(0, Math.min(1, v / 100)) } });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><div><CardTitle>What matters, and how much</CardTitle>
          <CardDescription>Weights are normalised to 100%. Fit = Σ weight × how well the lead matches (0-100%).</CardDescription></div></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {WEIGHTS.map((w) => (
            <label key={w.key} className="rounded-xl border border-line p-3 text-[13px]">
              <div className="mb-1 flex items-baseline justify-between"><span className="font-medium">{w.label}</span>
                <span className="tabular text-ink-3">{Math.round((icp.weights[w.key] / total) * 100)}%</span></div>
              <input type="range" min={0} max={100} value={pctOf(icp.weights[w.key])} onChange={(e) => setWeight(w.key, Number(e.target.value))}
                className="w-full accent-[var(--brand)]" aria-label={`${w.label} weight`} />
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.key}>
            <CardHeader><div><CardTitle>{g.label}</CardTitle><CardDescription>100% = ideal, 0% = no fit. Unlisted values count as a neutral default.</CardDescription></div></CardHeader>
            <CardContent className="space-y-1.5">
              {Object.entries(icp[g.key]).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] items-center gap-3 text-[13px]">
                  <span className="truncate">{k.replace(/_/g, " ")}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${pctOf(v)}%` }} /></span>
                  <Input type="number" min={0} max={100} step={5} value={pctOf(v)} onChange={(e) => setValue(g.key, k, Number(e.target.value))}
                    className="h-8 text-right tabular" aria-label={`${k} value`} />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div><CardTitle>Effect on the pipeline</CardTitle><CardDescription>Try the change first: how many leads move between fit bands, and does the ranking still predict replies?</CardDescription></div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={() => start(async () => {
              const r = await previewIcp(icp);
              if (r.ok && r.data) setPreview(r.data.bands); else if (!r.ok) toast.error(r.error);
            })}><Eye />Preview</Button>
            <Button disabled={pending} onClick={() => start(async () => {
              const r = await saveIcp(icp, name);
              if (r.ok) { toast.success(r.message); setPreview(null); } else toast.error(r.error);
            })}><Save />Save &amp; re-score</Button>
          </div>
        </CardHeader>
        <Table>
          <THead><TR><TH>Fit band</TH><TH className="text-right">Leads now</TH><TH className="text-right">Reply rate now</TH>
            {preview ? <><TH className="text-right">Leads with change</TH><TH className="text-right">Reply rate with change</TH></> : null}</TR></THead>
          <TBody>
            {current.filter((b) => b.leads || preview?.find((p) => p.band === b.band)?.leads).map((b) => {
              const p = preview?.find((x) => x.band === b.band);
              return (
                <TR key={b.band}>
                  <TD className="font-medium">{b.band} <span className="text-[12px] font-normal text-ink-3">{b.band === "A" ? "fit ≥ 80" : b.band === "B" ? "65-80" : b.band === "C" ? "50-65" : "< 50"}</span></TD>
                  <TD className="text-right tabular">{b.leads}</TD>
                  <TD className="text-right tabular">{b.contacted ? `${Math.round((b.replied / b.contacted) * 100)}%` : "–"} <span className="text-ink-3">({b.replied}/{b.contacted})</span></TD>
                  {p ? <>
                    <TD className="text-right tabular">{p.leads}{p.leads !== b.leads ? <span className={p.leads > b.leads ? "text-brand" : "text-warn"}> ({p.leads > b.leads ? "+" : ""}{p.leads - b.leads})</span> : null}</TD>
                    <TD className="text-right tabular">{p.contacted ? `${Math.round((p.replied / p.contacted) * 100)}%` : "–"} <span className="text-ink-3">({p.replied}/{p.contacted})</span></TD>
                  </> : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
        <CardContent className="pt-3 text-[12.5px] text-ink-3">A good profile puts the leads that actually reply into band A. If band B or C replies more often than A, the profile is pointing at the wrong organisations.</CardContent>
      </Card>
    </div>
  );
}
