import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { CycleControls, NewCycleDialog, PositionControls, TemplateEditor } from "@/components/hr/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getCycles, getPositions } from "@/lib/hr/queries";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Cycles & forms" };

export default async function HrSettingsPage() {
  const user = await requireRole("hr");
  const cycles = await getCycles(user);
  const open = cycles.find((c) => c.status === "open") ?? cycles[0];
  const [positions, extra] = await Promise.all([
    open ? getPositions(user, open.id) : Promise.resolve([]),
    withUser(user.id, async (sql) => ({
      templates: await sql<{ id: string; name: string; subject: string; body: string; requires_review: boolean; is_active: boolean; trigger_stage: string | null; variant: string }[]>`
        select id, name, subject, body, requires_review, is_active, trigger_stage, variant from email_templates where department = 'hr' order by trigger_stage nulls last, key`,
      criteria: await sql<{ rubric: string; stage: string; label: string; weight: number; anchors: Record<string, string> }[]>`
        select r.name as rubric, r.stage::text, rc.label, rc.weight, rc.anchors from rubric_criteria rc join rubrics r on r.id = rc.rubric_id order by r.stage, rc.position`,
    })),
  ]);

  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Cycles & forms" description="Open a cycle to publish the application form. Changes are logged."
        actions={<NewCycleDialog cycles={cycles.map((c) => ({ id: c.id, name: c.name }))} />} />
      <Card className="mb-5">
        <CardHeader><div><CardTitle>Recruitment cycles</CardTitle><CardDescription>Only one cycle can be open at a time. Retention: rejected and withdrawn applications are anonymised automatically after the period.</CardDescription></div></CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead><TR><TH>Cycle</TH><TH>Dates</TH><TH className="text-right">Applications</TH><TH>Settings</TH></TR></THead>
            <TBody>
              {cycles.map((c) => (
                <TR key={c.id}>
                  <TD><div className="font-medium">{c.name}</div><Badge tone={c.status === "open" ? "brand" : "neutral"}>{c.status}</Badge></TD>
                  <TD className="whitespace-nowrap text-ink-2">{c.opens_at ? format(new Date(c.opens_at), "d MMM") : "–"} – {c.closes_at ? format(new Date(c.closes_at), "d MMM yyyy") : "–"}</TD>
                  <TD className="text-right tabular">{c.applications}</TD>
                  <TD><CycleControls cycle={c} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {open ? (
        <Card className="mb-5">
          <CardHeader>
            <div><CardTitle>Tracks in {open.name}</CardTitle><CardDescription>Places drive the “places filled” progress; closed tracks disappear from the form.</CardDescription></div>
            <a href="/apply" target="_blank" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">Public form<ExternalLink className="size-3.5" /></a>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead><TR><TH>Track</TH><TH>Questions</TH><TH>Places · open</TH></TR></THead>
              <TBody>
                {positions.map((p) => (
                  <TR key={p.id}>
                    <TD><div className="font-medium">{p.name}</div><div className="max-w-md text-[12.5px] text-ink-3">{p.description}</div></TD>
                    <TD className="text-[12.5px] text-ink-2">{p.questions.length} questions</TD>
                    <TD><PositionControls position={p} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>E-mail templates</CardTitle><CardDescription>Sent from the pipeline when a candidate changes stage</CardDescription></div></CardHeader>
          <CardContent className="space-y-3">{extra.templates.map((t) => <TemplateEditor key={t.id} t={t} />)}</CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader><div><CardTitle>Scorecard rubrics</CardTitle><CardDescription>Anchored 1-5 scales; weights feed the weighted average and calibration</CardDescription></div></CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead><TR><TH>Stage</TH><TH>Criterion</TH><TH className="text-right">Weight</TH></TR></THead>
              <TBody>
                {extra.criteria.map((c, i) => (
                  <TR key={i}><TD className="capitalize text-ink-3">{c.stage}</TD>
                    <TD><div>{c.label}</div><div className="text-[12px] text-ink-3">1 = {c.anchors["1"]} · 5 = {c.anchors["5"]}</div></TD>
                    <TD className="text-right tabular">×{c.weight}</TD></TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
