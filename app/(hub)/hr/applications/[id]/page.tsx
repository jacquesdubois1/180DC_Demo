import { ArrowLeft, ExternalLink, FileText, Link2, Mail, Phone, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CvExtraction } from "@/components/hr/candidate/cv-extraction";
import { CommentBox } from "@/components/hr/candidate/comment-box";
import { EmailReview } from "@/components/hr/candidate/email-review";
import { InterviewDialog } from "@/components/hr/candidate/interview-dialog";
import { ReviewerEditor } from "@/components/hr/candidate/reviewer-editor";
import { StageActions } from "@/components/hr/candidate/stage-actions";
import { StageBadge } from "@/components/hr/stage-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getApplicationDetail, getReviewerPool } from "@/lib/hr/queries";
import { RECOMMENDATION_META, type Recommendation, STAGE_META, type ApplicationStage } from "@/lib/hr/stages";
import { format, formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Candidate" };

export default async function CandidatePage(props: PageProps<"/hr/applications/[id]">) {
  const user = await requireRole("hr");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getApplicationDetail(user, id);
  if (!d) notFound();
  const { app, position, reviews, assigned, criteria, comments, history, interviews, emails, conflicts } = d;
  const pool = await getReviewerPool(user, app.cycle_id);
  await withUser(user.id, (sql) => sql`select app.log_event('application.viewed', 'application', ${id}::uuid, '{}'::jsonb)`);
  const name = `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || app.alias;
  const poolOptions = pool.map((p) => ({ id: p.user_id, name: p.display_name, load: p.open, capacity: p.max_reviews }));
  const conflictIds = pool.filter((p) => conflicts.some((c) => c.reviewer_name === p.display_name)).map((p) => p.user_id);

  return (
    <>
      <Link href={`/hr/pipeline`} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Pipeline</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1">{app.position_name} · {app.cycle_name}</div>
          <h1 className="flex flex-wrap items-center gap-3 text-[26px] font-semibold tracking-tight">
            {name}<StageBadge stage={app.stage as ApplicationStage} />
            <span className="font-mono text-[13px] font-normal text-ink-3">{app.alias}</span>
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Applied {format(new Date(app.submitted_at), "d MMM yyyy, HH:mm")} · in this stage for {formatDistanceToNow(new Date(app.stage_changed_at))}
            {app.second_choice ? ` · 2nd choice: ${app.second_choice}` : ""}
          </p>
        </div>
        <StageActions applicationId={app.id} stage={app.stage as ApplicationStage} name={name} />
      </div>

      {emails.filter((e) => e.status === "needs_review").map((e) => <div key={e.id} className="mb-5"><EmailReview email={e} /></div>)}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-2">
              <Info icon={<Mail className="size-4" />} label="E-mail" value={app.email ? <a className="hover:text-brand" href={`mailto:${app.email}`}>{app.email}</a> : "–"} />
              <Info icon={<Phone className="size-4" />} label="Phone" value={app.phone ?? "–"} />
              <Info icon={<Link2 className="size-4" />} label="LinkedIn" value={app.linkedin_url ? <a className="inline-flex items-center gap-1 hover:text-brand" href={app.linkedin_url} target="_blank" rel="noreferrer">Profile<ExternalLink className="size-3" /></a> : "–"} />
              <Info label="Nationality" value={app.nationality ?? "–"} />
              <Info label="University" value={app.university ?? "–"} />
              <Info label="Program · year" value={`${app.degree_program ?? "–"} · ${app.study_year ?? "–"}`} />
              <Info label="Languages" value={app.languages?.join(", ") || "–"} />
              <Info label="Heard about us" value={app.heard_from ?? "–"} />
              <Info label="Consent" value={`${format(new Date(app.consent_at), "d MMM yyyy")} · notice v${app.consent_version}`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Answers</CardTitle><CardDescription>As submitted in the application form</CardDescription></div></CardHeader>
            <CardContent className="space-y-4">
              {position.questions.map((q) => (
                <div key={q.key}>
                  <div className="text-[13px] font-medium text-ink-2">{q.label}</div>
                  <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed">{app.answers?.[q.key] ?? <span className="text-ink-3">–</span>}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div><CardTitle className="flex items-center gap-2"><FileText className="size-4" />CV</CardTitle>
                <CardDescription>Opens through an access-checked link; every view is logged</CardDescription></div>
              {app.cv_file_id ? <a href={`/api/files/${app.cv_file_id}`} target="_blank" className="text-[13px] font-medium text-brand hover:underline">Open in new tab</a> : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {app.cv_file_id ? (
                <>
                  <CvExtraction applicationId={app.id} extracted={app.extracted} extractedAt={app.extracted_at} />
                  <iframe src={`/api/files/${app.cv_file_id}`} title="CV" className="h-[560px] w-full rounded-xl border border-line bg-white" />
                </>
              ) : <EmptyState title="No CV uploaded" />}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div><CardTitle>Scorecards</CardTitle><CardDescription>Scores 1-5 per criterion; reviewers worked blind</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <ReviewerEditor applicationId={app.id} stage="screening" pool={poolOptions} conflicts={conflictIds}
                  assigned={assigned.filter((a) => a.stage === "screening").map((a) => pool.find((p) => p.display_name === a.reviewer_name)?.user_id ?? "").filter(Boolean)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {(["screening", "interview"] as const).map((stage) => {
                const rs = reviews.filter((r) => r.stage === stage);
                const crit = criteria.filter((c) => c.stage === stage);
                const asg = assigned.filter((a) => a.stage === stage);
                if (!rs.length && !asg.length) return null;
                return (
                  <div key={stage}>
                    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold capitalize">{stage}
                      <span className="font-normal text-ink-3">{rs.filter((r) => r.submitted_at).length}/{asg.length} submitted</span></div>
                    <Table>
                      <THead><TR><TH>Criterion</TH>{asg.map((a) => <TH key={a.reviewer_id} className="text-center">{a.reviewer_name.split(" ")[0]}</TH>)}</TR></THead>
                      <TBody>
                        {crit.map((c) => (
                          <TR key={c.key}>
                            <TD className="text-[13px]">{c.label}{c.weight !== 1 ? <span className="ml-1 text-[11px] text-ink-3">×{c.weight}</span> : null}</TD>
                            {asg.map((a) => {
                              const r = rs.find((x) => x.reviewer_id === a.reviewer_id);
                              const v = r?.submitted_at ? r.scores?.[c.key] : undefined;
                              return <TD key={a.reviewer_id} className="text-center font-semibold tabular">{v ?? <span className="font-normal text-ink-3">·</span>}</TD>;
                            })}
                          </TR>
                        ))}
                        <TR>
                          <TD className="text-[13px] font-medium">Recommendation</TD>
                          {asg.map((a) => {
                            const r = rs.find((x) => x.reviewer_id === a.reviewer_id);
                            const rec = r?.submitted_at ? (r.recommendation as Recommendation | null) : null;
                            return <TD key={a.reviewer_id} className="text-center">{rec ? <Badge tone={RECOMMENDATION_META[rec].tone}>{RECOMMENDATION_META[rec].label}</Badge> : <span className="text-[12px] text-ink-3">pending</span>}</TD>;
                          })}
                        </TR>
                      </TBody>
                    </Table>
                    {rs.filter((r) => r.submitted_at && r.comment).map((r) => (
                      <p key={r.id} className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]"><span className="font-medium">{r.reviewer_name}:</span> {r.comment}</p>
                    ))}
                  </div>
                );
              })}
              {conflicts.length ? (
                <p className="flex items-center gap-2 text-[12.5px] text-warn"><ShieldAlert className="size-4" />Declared conflict: {conflicts.map((c) => `${c.reviewer_name}${c.reason ? ` (${c.reason})` : ""}`).join(", ")}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Interviews</CardTitle></div><InterviewDialog applicationId={app.id} pool={poolOptions} /></CardHeader>
            <CardContent>
              {interviews.length ? (
                <ul className="space-y-2 text-[13.5px]">
                  {interviews.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="font-medium">{format(new Date(i.scheduled_at), "EEE d MMM, HH:mm")}</span>
                      <span className="text-ink-3">{i.duration_minutes} min · {i.format === "online" ? "online" : "in person"}{i.location ? ` · ${i.location}` : ""}</span>
                      <span className="text-ink-3">· {i.interviewers.join(", ")}</span>
                      <Badge tone={i.status === "done" ? "brand" : i.status === "scheduled" ? "info" : "neutral"} className="ml-auto">{i.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-ink-3">No interview scheduled.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <CommentBox applicationId={app.id} />
              {comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-surface-2 px-3 py-2 text-[13.5px]">
                  <div className="mb-0.5 flex items-center gap-2 text-[12px] text-ink-3">{c.author_name} · {formatDistanceToNow(new Date(c.created_at))} ago
                    {c.visibility === "reviewers" ? <Badge tone="outline">shared with interviewers</Badge> : null}</div>
                  {c.body}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>History & e-mails</CardTitle></CardHeader>
            <CardContent>
              <ol className="relative space-y-3 border-l border-line pl-4 text-[13px]">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-brand" />
                    <div><span className="font-medium">{STAGE_META[h.to_status as ApplicationStage]?.label ?? h.to_status}</span>
                      <span className="text-ink-3"> · {format(new Date(h.changed_at), "d MMM, HH:mm")}{h.changed_by_name ? ` · ${h.changed_by_name}` : ""}</span></div>
                    {h.note ? <div className="text-ink-2">{h.note}</div> : null}
                  </li>
                ))}
              </ol>
              {emails.length ? (
                <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
                  {emails.map((e) => (
                    <li key={e.id} className="flex items-center gap-2">
                      <Mail className="size-3.5 text-ink-3" /><span className="flex-1 truncate">{e.subject}</span>
                      <Badge tone={e.status === "sent" ? "brand" : e.status === "needs_review" ? "warn" : e.status === "failed" ? "danger" : "neutral"}>{e.status.replace("_", " ")}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Info({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-3">{icon}{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}
