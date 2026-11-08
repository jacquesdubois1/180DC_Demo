import type { Metadata } from "next";
import Link from "next/link";
import { EmailReview } from "@/components/hr/candidate/email-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export const metadata: Metadata = { title: "HR e-mails" };

export default async function HrEmailsPage() {
  const user = await requireRole("hr");
  const { review, log } = await withUser(user.id, async (sql) => ({
    review: await sql<{ id: string; subject: string; body_text: string; status: string; to_email: string; application_id: string | null; name: string | null }[]>`
      select o.id, o.subject, o.body_text, o.status::text, o.to_email::text, o.application_id,
             (select first_name || ' ' || last_name from people p where p.id = o.to_person_id) as name
      from email_outbox o where o.department = 'hr' and o.status = 'needs_review' order by o.created_at`,
    log: await sql<{ id: string; subject: string; status: string; to_email: string; sent_at: string | null; created_at: string; last_error: string | null }[]>`
      select id, subject, status::text, to_email::text, sent_at, created_at, last_error from email_outbox
      where department = 'hr' and status <> 'needs_review' order by created_at desc limit 100`,
  }));
  return (
    <>
      <PageHeader eyebrow="Recruitment" title="E-mails to candidates"
        description="Automatic confirmations go out immediately. Decision e-mails (interview invitations, offers, rejections) wait here until a person approves them." />
      <Card className="mb-5">
        <CardHeader><CardTitle>Waiting for approval ({review.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {review.length ? review.map((e) => (
            <div key={e.id}>
              <div className="mb-1.5 text-[13px] text-ink-2">To <b>{e.name ?? e.to_email}</b> · {e.to_email}
                {e.application_id ? <> · <Link className="text-brand hover:underline" href={`/hr/applications/${e.application_id}`}>candidate</Link></> : null}</div>
              <EmailReview email={e} />
            </div>
          )) : <EmptyState title="Nothing to approve" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Log (last 100)</CardTitle></CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead><TR><TH>Subject</TH><TH>To</TH><TH>Status</TH><TH>When</TH></TR></THead>
            <TBody>
              {log.map((e) => (
                <TR key={e.id}>
                  <TD className="max-w-80 truncate">{e.subject}</TD>
                  <TD className="text-ink-2">{e.to_email}</TD>
                  <TD><Badge tone={e.status === "sent" ? "brand" : e.status === "failed" ? "danger" : "neutral"} title={e.last_error ?? undefined}>{e.status}</Badge></TD>
                  <TD className="whitespace-nowrap text-ink-3">{format(new Date(e.sent_at ?? e.created_at), "d MMM, HH:mm")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
