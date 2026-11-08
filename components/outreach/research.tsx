"use client";

import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { decideSuggestion, runResearch } from "@/lib/outreach/ai-actions";

const TYPES = [["social_enterprise", "Social enterprise"], ["ngo", "NGO"], ["foundation", "Foundation"], ["startup", "Impact start-up"], ["company", "Company"], ["public_sector", "Public sector"]] as const;
const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

export function ResearchForm({ sectors, mode }: { sectors: string[]; mode: "off" | "mock" | "live" }) {
  const [chosen, setChosen] = useState<string[]>(sectors.slice(0, 2));
  const [types, setTypes] = useState<string[]>(["social_enterprise", "ngo"]);
  const [sizes, setSizes] = useState<string[]>(["11-50", "51-200"]);
  const [city, setCity] = useState("Barcelona");
  const [keywords, setKeywords] = useState("");
  const [count, setCount] = useState(6);
  const [pending, start] = useTransition();
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="space-y-4">
      <Field label="Sectors">
        <div className="flex flex-wrap gap-1.5">
          {sectors.map((s) => (
            <button key={s} type="button" onClick={() => toggle(chosen, s, setChosen)}
              className={`rounded-full border px-2.5 py-1 text-[12.5px] ${chosen.includes(s) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-surface-2"}`}>{s}</button>
          ))}
        </div>
      </Field>
      <Field label="Organisation types">
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => toggle(types, v, setTypes)}
              className={`rounded-full border px-2.5 py-1 text-[12.5px] ${types.includes(v) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-surface-2"}`}>{l}</button>
          ))}
        </div>
      </Field>
      <Field label="Team size">
        <div className="flex flex-wrap gap-1.5">
          {SIZES.map((v) => (
            <button key={v} type="button" onClick={() => toggle(sizes, v, setSizes)}
              className={`rounded-full border px-2.5 py-1 text-[12.5px] tabular ${sizes.includes(v) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-surface-2"}`}>{v}</button>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
        <Field label="City or region"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="Anything else?" hint="e.g. “recently raised funding”, “expanding to new cities”"><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={300} /></Field>
        <Field label="How many"><Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[3, 6, 10, 15].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-3">
          {mode === "live" ? "Claude searches the web, then returns structured suggestions with sources. Takes about a minute; cost is logged."
            : mode === "mock" ? "Demo mode: fictional suggestions, no API call. Set AI_MODE=live and an Anthropic key to search the real web."
            : "AI features are switched off (AI_MODE=off)."}
        </p>
        <Button disabled={pending || mode === "off" || !chosen.length || !types.length} onClick={() => start(async () => {
          const r = await runResearch({ sectors: chosen, orgTypes: types, sizeBands: sizes, city, keywords, count });
          if (r.ok) toast.success(r.message); else toast.error(r.error);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{pending ? "Researching…" : "Find organisations"}</Button>
      </div>
    </div>
  );
}

export interface SuggestionItem {
  id: string; name: string; website: string | null; org_type: string | null; sector: string | null; city: string | null; rationale: string;
  sources: string[]; suggested_contact_role: string | null; fit_score: number | null; status: string; organization_id: string | null; lead_id: string | null;
}

export function SuggestionCard({ s }: { s: SuggestionItem }) {
  const [pending, start] = useTransition();
  const decide = (d: "accepted" | "rejected") => start(async () => {
    const r = await decideSuggestion(s.id, d);
    if (r.ok) toast.success(r.message); else toast.error(r.error);
  });
  return (
    <div className="rounded-xl border border-line p-4 text-[13.5px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {s.name}
            {s.status === "duplicate" ? <Badge tone="warn">already in CRM</Badge> : null}
            {s.status === "accepted" ? <Badge tone="brand">added</Badge> : null}
            {s.status === "rejected" ? <Badge>rejected</Badge> : null}
          </div>
          <div className="text-[12.5px] text-ink-3">{[s.org_type?.replace("_", " "), s.sector, s.city].filter(Boolean).join(" · ")}
            {s.website ? <> · <a href={s.website} target="_blank" rel="noreferrer" className="hover:text-brand">{s.website.replace(/^https?:\/\//, "")}</a></> : null}</div>
        </div>
        {s.fit_score !== null ? <div className="text-right"><div className="text-[18px] font-semibold tabular">{Math.round(s.fit_score)}</div><div className="text-[11px] text-ink-3">AI fit</div></div> : null}
      </div>
      <p className="mt-2 text-ink-2">{s.rationale}</p>
      {s.suggested_contact_role ? <p className="mt-1 text-[12.5px] text-ink-3">Contact: {s.suggested_contact_role}</p> : null}
      {s.sources.length ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          {s.sources.slice(0, 4).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-3 hover:text-brand"><ExternalLink className="size-3" />{(() => { try { return new URL(u).hostname; } catch { return u.slice(0, 40); } })()}</a>)}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {s.status === "pending" ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => decide("accepted")}><Check />Add to pipeline</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("rejected")}><X />Not a fit</Button>
          </>
        ) : null}
        {s.lead_id ? <Link href={`/outreach/leads/${s.lead_id}`} className="text-[13px] text-brand hover:underline">Open lead</Link> : null}
      </div>
    </div>
  );
}
