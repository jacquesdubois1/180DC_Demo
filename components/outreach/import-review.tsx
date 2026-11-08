"use client";

import { Check, GitMerge, Plus, SkipForward, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { commitImport, discardImport, remapImport, setImportDecision } from "@/lib/outreach/import-actions";
import { IMPORT_FIELDS, type ColumnMapping, type ImportField } from "@/lib/outreach/import-map";

export interface ReviewRow {
  id: string; row_number: number; match_status: string; decision: string; match_reason: string | null; similarity: number | null;
  matched_name: string | null;
  normalized: { organization: string | null; domain: string | null; first_name: string | null; last_name: string | null; email: string | null;
    title: string | null; city: string | null; sector: string | null; is_alumni: boolean; warnings: string[] };
}

const STATUS: Record<string, { label: string; tone: "brand" | "warn" | "danger" | "info" | "neutral" | "violet" }> = {
  new: { label: "new", tone: "brand" },
  duplicate: { label: "already in CRM", tone: "info" },
  possible_duplicate: { label: "possible duplicate", tone: "warn" },
  in_file_duplicate: { label: "repeated in file", tone: "neutral" },
  invalid: { label: "invalid", tone: "danger" },
};
const DECISION: Record<string, string> = { create: "create new", merge: "add to existing", skip: "skip", pending: "decide" };

export function MappingEditor({ importId, headers, mapping, disabled }: { importId: string; headers: string[]; mapping: ColumnMapping; disabled: boolean }) {
  const [m, setM] = useState<ColumnMapping>(mapping);
  const [pending, start] = useTransition();
  const fields = Object.keys(IMPORT_FIELDS) as ImportField[];
  return (
    <div className="space-y-3">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
        {fields.map((f) => (
          <Field key={f} label={IMPORT_FIELDS[f]}>
            <Select value={m[f] ?? ""} disabled={disabled} onChange={(e) => setM({ ...m, [f]: e.target.value || undefined })}>
              <option value="">- not in file -</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      {!disabled ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await remapImport(importId, m);
            if (r.ok) toast.success(r.message); else toast.error(r.error);
          })}>Apply columns &amp; re-check</Button>
        </div>
      ) : null}
    </div>
  );
}

export function ReviewTable({ importId, rows, team, editable }: { importId: string; rows: ReviewRow[]; team: { id: string; display_name: string }[]; editable: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>(rows.some((r) => r.decision === "pending") ? "pending" : "all");
  const [ownerMode, setOwnerMode] = useState<string>("round_robin");
  const [source, setSource] = useState<"import" | "alumni" | "event" | "referral">("import");
  const [pending, start] = useTransition();
  const shown = useMemo(() => rows.filter((r) => filter === "all" ? true : filter === "pending" ? r.decision === "pending" : r.match_status === filter), [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, pending: rows.filter((r) => r.decision === "pending").length };
    for (const r of rows) c[r.match_status] = (c[r.match_status] ?? 0) + 1;
    return c;
  }, [rows]);
  const willCreate = rows.filter((r) => r.decision === "create").length;
  const willMerge = rows.filter((r) => r.decision === "merge").length;
  const decide = (ids: string[], d: "create" | "merge" | "skip") => start(async () => {
    const r = await setImportDecision(importId, ids, d);
    if (!r.ok) toast.error(r.error);
    router.refresh();
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-wrap">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "pending", "new", "duplicate", "possible_duplicate", "in_file_duplicate", "invalid"] as const).filter((k) => k === "all" || counts[k]).map((k) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-[12.5px] ${filter === k ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:bg-line"}`}>
                {k === "all" ? "All" : k === "pending" ? "Needs decision" : STATUS[k].label} · {counts[k] ?? 0}
              </button>
            ))}
          </div>
          {editable && filter === "pending" && shown.length ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(shown.map((r) => r.id), "merge")}><GitMerge />All: add to existing</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(shown.map((r) => r.id), "create")}><Plus />All: create new</Button>
            </div>
          ) : null}
        </CardHeader>
        <Table>
          <THead><TR><TH className="w-14">Row</TH><TH>Organisation</TH><TH>Contact</TH><TH>Check result</TH><TH className="w-[230px]">Decision</TH></TR></THead>
          <TBody>
            {shown.slice(0, 400).map((r) => {
              const n = r.normalized;
              return (
                <TR key={r.id}>
                  <TD className="tabular text-ink-3">{r.row_number}</TD>
                  <TD>
                    <div className="font-medium">{n.organization ?? <span className="text-danger">missing</span>}</div>
                    <div className="text-[12px] text-ink-3">{[n.domain, n.sector, n.city].filter(Boolean).join(" · ") || "–"}</div>
                  </TD>
                  <TD>
                    <div>{[n.first_name, n.last_name].filter(Boolean).join(" ") || <span className="text-ink-3">no name</span>}{n.is_alumni ? <Badge tone="violet" className="ml-1.5">alumni</Badge> : null}</div>
                    <div className="text-[12px] text-ink-3">{[n.title, n.email].filter(Boolean).join(" · ") || "no e-mail"}</div>
                  </TD>
                  <TD>
                    <Badge tone={STATUS[r.match_status]?.tone ?? "neutral"}>{STATUS[r.match_status]?.label ?? r.match_status}</Badge>
                    {r.match_reason ? <div className="mt-0.5 text-[12px] text-ink-2">{r.match_reason}</div> : null}
                    {n.warnings.length ? <div className="mt-0.5 text-[12px] text-warn">{n.warnings.join(" · ")}</div> : null}
                  </TD>
                  <TD>
                    {editable && r.match_status !== "invalid" ? (
                      <div className="flex gap-1">
                        {r.matched_name || r.match_status === "in_file_duplicate" ? (
                          <DecisionButton active={r.decision === "merge"} disabled={pending} onClick={() => decide([r.id], "merge")} title={`Add to ${r.matched_name ?? "the organisation above"}`}><GitMerge className="size-3.5" />existing</DecisionButton>
                        ) : null}
                        {r.match_status !== "in_file_duplicate" ? <DecisionButton active={r.decision === "create"} disabled={pending} onClick={() => decide([r.id], "create")} title="Create a new organisation"><Plus className="size-3.5" />new</DecisionButton> : null}
                        <DecisionButton active={r.decision === "skip"} disabled={pending} onClick={() => decide([r.id], "skip")} title="Do not import this row"><SkipForward className="size-3.5" />skip</DecisionButton>
                      </div>
                    ) : <span className={`text-[12.5px] ${r.decision === "pending" ? "text-warn" : "text-ink-2"}`}>{DECISION[r.decision]}</span>}
                  </TD>
                </TR>
              );
            })}
            {shown.length > 400 ? <TR><TD colSpan={5} className="text-center text-[12.5px] text-ink-3">Showing the first 400 of {shown.length} rows.</TD></TR> : null}
          </TBody>
        </Table>
      </Card>

      {editable ? (
        <Card>
          <CardHeader><div><CardTitle>Import</CardTitle><CardDescription>{willCreate} new organisations · {willMerge} rows added to existing ones · {counts.pending} still to decide</CardDescription></div></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label="Lead owner" className="w-64">
              <Select value={ownerMode} onChange={(e) => setOwnerMode(e.target.value)}>
                <option value="round_robin">Share fairly (fewest open leads first)</option>
                <option value="me">Me</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
              </Select>
            </Field>
            <Field label="Source" className="w-48">
              <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="import">List import</option><option value="alumni">Alumni network</option><option value="event">Event</option><option value="referral">Referral</option>
              </Select>
            </Field>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => start(async () => {
                if (!confirm("Discard this import? The uploaded rows are deleted.")) return;
                const r = await discardImport(importId);
                if (r.ok) { toast.success(r.message); router.push("/outreach/import"); } else toast.error(r.error);
              })}><Trash2 />Discard</Button>
              <Button disabled={pending || counts.pending > 0} title={counts.pending ? "Decide the possible duplicates first" : undefined} onClick={() => start(async () => {
                const owner = ownerMode === "me" || ownerMode === "round_robin" ? { mode: ownerMode } as const : { mode: "user" as const, userId: ownerMode };
                const r = await commitImport({ importId, owner, source });
                if (r.ok) { toast.success(r.message); router.push("/outreach/pipeline"); } else toast.error(r.error);
              })}><Check />Import {willCreate + willMerge} rows</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DecisionButton({ active, children, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button {...props} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] disabled:opacity-50 ${active ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-surface-2"}`}>
      {children}
    </button>
  );
}
