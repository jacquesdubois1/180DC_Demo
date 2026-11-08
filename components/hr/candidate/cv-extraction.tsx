"use client";

import { Sparkles } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applyExtraction, extractCv } from "@/lib/hr/actions";

type Facts = {
  linkedin_url: string | null; nationality: string | null; university: string | null; degree_program: string | null;
  languages: string[]; skills: string[]; experience_summary: string; impact_experience: boolean; _model?: string;
};

export function CvExtraction({ applicationId, extracted, extractedAt }: { applicationId: string; extracted: Record<string, unknown> | null; extractedAt: string | null }) {
  const [pending, start] = useTransition();
  const f = extracted as Facts | null;
  const run = () => start(async () => {
    const r = await extractCv(applicationId);
    if (r.ok) toast.success(r.message); else toast.error(r.error);
  });
  if (!f) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-3">
        <p className="text-[13px] text-ink-2">Let AI read the CV and suggest LinkedIn, nationality, education and skills.</p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={run}><Sparkles />{pending ? "Reading CV…" : "Extract with AI"}</Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-violet/25 bg-violet-soft/40 p-4 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="violet"><Sparkles className="size-3" />AI suggestion</Badge>
        <span className="text-ink-3">{f._model}{extractedAt ? ` · ${new Date(extractedAt).toLocaleString("en-GB")}` : ""} · verify before use</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={run}>Re-run</Button>
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Row k="LinkedIn" v={f.linkedin_url} />
        <Row k="Nationality (as stated)" v={f.nationality} />
        <Row k="University" v={f.university} />
        <Row k="Program" v={f.degree_program} />
        <Row k="Languages" v={f.languages?.join(", ")} />
        <Row k="Skills" v={f.skills?.join(", ")} />
      </dl>
      <p className="mt-2 text-ink-2">{f.experience_summary}{f.impact_experience ? " Mentions impact / volunteering work." : ""}</p>
      {f.linkedin_url || f.nationality ? (
        <Button size="sm" variant="outline" className="mt-3" disabled={pending}
          onClick={() => start(async () => {
            const r = await applyExtraction(applicationId, ["linkedin_url", "nationality"]);
            if (r.ok) toast.success(r.message); else toast.error(r.error);
          })}>Copy LinkedIn &amp; nationality to profile</Button>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-2"><dt className="w-36 shrink-0 text-ink-3">{k}</dt><dd className="min-w-0 truncate">{v || "–"}</dd></div>
  );
}
