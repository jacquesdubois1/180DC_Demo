import { ArrowLeft, EyeOff, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type Criterion, Scorecard } from "@/components/hr/scorecard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { RECOMMENDATION_META, type Recommendation } from "@/lib/hr/stages";

export const metadata: Metadata = { title: "Scorecard" };

export default async function ReviewPage(props: PageProps<"/reviews/[applicationId]">) {
  const user = await requireUser();
  const { applicationId } = await props.params;
  const sp = await props.searchParams;
  const stage = sp.stage === "interview" ? "interview" : "screening";
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) notFound();

  const data = await withUser(user.id, async (sql) => {
    const [a] = await sql<{ alias: string; cycle_name: string; position_name: string; is_blind: boolean; candidate_name: string | null;
      degree_program: string | null; study_year: string | null; university: string | null; languages: string[];
      answers: Record<string, string>; questions: { key: string; label: string }[]; cv_file_id: string | null; rubric_id: string;
      my_submitted_at: string | null; due_at: string | null }[]>`
      select alias, cycle_name, position_name, is_blind, candidate_name, degree_program, study_year, university, languages,
             answers, questions, cv_file_id, rubric_id, my_submitted_at, due_at
      from app.my_review_assignments() where application_id = ${applicationId} and review_stage = ${stage}`;
    if (!a) return null;
    const criteria = await sql<Criterion[]>`select key, label, description, anchors, weight from rubric_criteria
      where rubric_id = ${a.rubric_id} order by position`;
    const [mine] = await sql<{ scores: Record<string, number>; recommendation: Recommendation | null; comment: string | null }[]>`
      select scores, recommendation::text, comment from reviews where application_id = ${applicationId} and reviewer_id = ${user.id} and stage = ${stage}`;
    // row-level security only returns other reviews once mine is submitted
    const others = await sql<{ reviewer: string; scores: Record<string, number>; recommendation: Recommendation | null; comment: string | null }[]>`
      select u.display_name as reviewer, r.scores, r.recommendation::text, r.comment from reviews r join app_users u on u.id = r.reviewer_id
      where r.application_id = ${applicationId} and r.stage = ${stage} and r.reviewer_id <> ${user.id} and r.submitted_at is not null`;
    const comments = await sql<{ body: string; created_at: string }[]>`select body, created_at from application_comments
      where application_id = ${applicationId} order by created_at desc`;
    return { a, criteria, mine, others, comments };
  });
  if (!data) notFound();
  const { a, criteria, mine, others, comments } = data;

  return (
    <>
      <Link href="/reviews" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />My reviews</Link>
      <div className="mb-6">
        <div className="eyebrow mb-1">{a.position_name} · {a.cycle_name} · {stage} scorecard</div>
        <h1 className="flex flex-wrap items-center gap-3 text-[26px] font-semibold tracking-tight">
          {a.candidate_name ?? <span className="inline-flex items-center gap-2"><EyeOff className="size-5 text-ink-3" />Candidate {a.alias}</span>}
          {a.is_blind ? <Badge tone="violet">blind review</Badge> : null}
        </h1>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>Application</CardTitle>
              <CardDescription>{a.is_blind ? "Identity, nationality and university are hidden to reduce bias." : "Interview stage: full profile visible."}</CardDescription></div></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-[13px]">
                <Badge tone="outline">{a.degree_program}</Badge><Badge tone="outline">{a.study_year}</Badge>
                {a.university ? <Badge tone="outline">{a.university}</Badge> : null}
                {a.languages?.map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
              </div>
              {a.questions.map((q) => (
                <div key={q.key}>
                  <div className="text-[13px] font-medium text-ink-2">{q.label}</div>
                  <p className="mt-1 whitespace-pre-line leading-relaxed">{a.answers?.[q.key] ?? "–"}</p>
                </div>
              ))}
              {a.cv_file_id ? (
                <a href={`/api/files/${a.cv_file_id}`} target="_blank" className="inline-flex items-center gap-2 text-[13px] font-medium text-brand hover:underline">
                  <FileText className="size-4" />Open CV
                </a>
              ) : null}
            </CardContent>
          </Card>
          {comments.length ? (
            <Card>
              <CardHeader><CardTitle>Notes from HR</CardTitle></CardHeader>
              <CardContent className="space-y-2">{comments.map((c, i) => <p key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-[13.5px]">{c.body}</p>)}</CardContent>
            </Card>
          ) : null}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>Your scorecard</CardTitle><CardDescription>Score each criterion against the anchors, then recommend.</CardDescription></div></CardHeader>
            <CardContent>
              <Scorecard applicationId={applicationId} stage={stage} criteria={criteria} initial={mine ?? null} submitted={!!a.my_submitted_at} />
            </CardContent>
          </Card>
          {a.my_submitted_at ? (
            <Card>
              <CardHeader><div><CardTitle>Panel</CardTitle><CardDescription>Compare your scores with the other reviewers</CardDescription></div></CardHeader>
              <CardContent className="pt-2">
                {others.length ? (
                  <Table>
                    <THead><TR><TH>Criterion</TH><TH className="text-center">You</TH>{others.map((o) => <TH key={o.reviewer} className="text-center">{o.reviewer.split(" ")[0]}</TH>)}</TR></THead>
                    <TBody>
                      {criteria.map((c) => (
                        <TR key={c.key}><TD>{c.label}</TD><TD className="text-center font-semibold">{mine?.scores?.[c.key] ?? "–"}</TD>
                          {others.map((o) => <TD key={o.reviewer} className="text-center tabular">{o.scores?.[c.key] ?? "–"}</TD>)}</TR>
                      ))}
                      <TR><TD className="font-medium">Recommendation</TD>
                        <TD className="text-center">{mine?.recommendation ? <Badge tone={RECOMMENDATION_META[mine.recommendation].tone}>{RECOMMENDATION_META[mine.recommendation].label}</Badge> : "–"}</TD>
                        {others.map((o) => <TD key={o.reviewer} className="text-center">{o.recommendation ? <Badge tone={RECOMMENDATION_META[o.recommendation].tone}>{RECOMMENDATION_META[o.recommendation].label}</Badge> : "–"}</TD>)}</TR>
                    </TBody>
                  </Table>
                ) : <p className="text-[13px] text-ink-3">The other reviewers have not submitted yet.</p>}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
