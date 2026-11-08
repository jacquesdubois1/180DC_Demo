import { ArrowRight, EyeOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format, isPast } from "date-fns";

export const metadata: Metadata = { title: "My reviews" };

interface Assignment {
  application_id: string; alias: string; cycle_name: string; position_name: string; review_stage: "screening" | "interview";
  application_stage: string; due_at: string | null; is_blind: boolean; candidate_name: string | null;
  my_submitted_at: string | null; my_review_id: string | null; reviews_submitted: number; reviewers_assigned: number;
}

export default async function ReviewsPage() {
  const user = await requireRole("interviewer", "hr");
  const rows = await withUser(user.id, (sql) => sql<Assignment[]>`
    select application_id, alias, cycle_name, position_name, review_stage, application_stage::text, due_at, is_blind,
           candidate_name, my_submitted_at, my_review_id, reviews_submitted, reviewers_assigned
    from app.my_review_assignments() order by my_submitted_at nulls first, due_at nulls last`);
  const open = rows.filter((r) => !r.my_submitted_at && ["received", "screening", "interview"].includes(r.application_stage));
  const done = rows.filter((r) => r.my_submitted_at);
  const overdue = open.filter((r) => r.due_at && isPast(new Date(r.due_at))).length;

  return (
    <>
      <PageHeader eyebrow="Reviewing" title="My reviews"
        description="Screening is blind: you see answers and studies, not names, nationality or university. You see other reviewers' scores only after submitting your own." />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Open" value={open.length} tone={open.length ? "brand" : "default"} />
        <Stat label="Overdue" value={overdue} tone={overdue ? "danger" : "default"} />
        <Stat label="Submitted" value={done.length} />
      </div>
      <Card>
        <CardHeader><CardTitle>To do</CardTitle></CardHeader>
        <CardContent className="pt-2">
          {open.length ? <List rows={open} /> : <EmptyState title="Nothing to review right now">New assignments appear here as soon as HR assigns them.</EmptyState>}
        </CardContent>
      </Card>
      {done.length ? (
        <Card className="mt-5">
          <CardHeader><CardTitle>Submitted</CardTitle></CardHeader>
          <CardContent className="pt-2"><List rows={done.slice(0, 50)} /></CardContent>
        </Card>
      ) : null}
    </>
  );
}

function List({ rows }: { rows: Assignment[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const late = !r.my_submitted_at && r.due_at && isPast(new Date(r.due_at));
        return (
          <li key={r.application_id + r.review_stage}>
            <Link href={`/reviews/${r.application_id}?stage=${r.review_stage}`} className="flex flex-wrap items-center gap-3 py-3 hover:text-brand">
              <span className="font-mono text-[12.5px] text-ink-3">{r.alias}</span>
              <span className="min-w-40 flex-1 font-medium">{r.candidate_name ?? <span className="inline-flex items-center gap-1.5 text-ink-2"><EyeOff className="size-3.5" />Anonymous candidate</span>}</span>
              <span className="text-[13px] text-ink-3">{r.position_name} · {r.cycle_name}</span>
              <Badge tone={r.review_stage === "interview" ? "violet" : "neutral"}>{r.review_stage}</Badge>
              <span className="text-[12.5px] text-ink-3 tabular">{r.reviews_submitted}/{r.reviewers_assigned} in</span>
              {r.my_submitted_at ? <Badge tone="brand">submitted</Badge>
                : r.due_at ? <Badge tone={late ? "danger" : "outline"}>due {format(new Date(r.due_at), "d MMM")}</Badge> : null}
              <ArrowRight className="size-4 text-ink-3" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
