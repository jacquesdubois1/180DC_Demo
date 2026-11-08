import type { Metadata } from "next";
import { AccessRequest, ErasureRequest, RetentionButton, SuppressionRow } from "@/components/admin/admin-tools";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Privacy & GDPR" };

export default async function PrivacyPage() {
  const admin = await requireRole("admin");
  const d = await withUser(admin.id, async (sql) => ({
    due: await sql<{ cycle_name: string; n: number; oldest: string }[]>`
      select cycle_name, count(*)::int as n, min(closed_at) as oldest from app.retention_candidates() group by cycle_name order by min(closed_at)`,
    cycles: await sql<{ name: string; status: string; retention_days: number; privacy_notice_version: string | null; total: number; anonymized: number }[]>`
      select c.name, c.status::text, c.retention_days, c.privacy_notice_version, count(a.id)::int as total,
             count(a.id) filter (where a.anonymized_at is not null)::int as anonymized
      from recruitment_cycles c left join applications a on a.cycle_id = c.id group by c.id order by c.opens_at desc nulls last`,
    suppressions: await sql<{ id: string; target: string; reason: string; source: string | null; created_at: string }[]>`
      select id, coalesce(email::text, '@' || domain::text) as target, reason, source, created_at from email_suppressions order by created_at desc limit 100`,
    events: await sql<{ action: string; at: string; actor: string | null; details: Record<string, unknown> }[]>`
      select a.action, a.at, (select display_name from app_users u where u.id = a.actor_id) as actor, a.details
      from audit_log a where a.action like 'gdpr.%' or a.action in ('person.erased', 'email.unsubscribed') order by a.at desc limit 12`,
    consent: (await sql<{ with_consent: number; total: number }[]>`
      select count(*) filter (where a.consent_version = c.privacy_notice_version)::int as with_consent, count(*)::int as total
      from applications a join recruitment_cycles c on c.id = a.cycle_id where a.anonymized_at is null`)[0],
  }));
  const dueTotal = d.due.reduce((s, r) => s + r.n, 0);

  return (
    <>
      <PageHeader eyebrow="Admin" title="Privacy & GDPR"
        description="Applicants and client contacts trust us with personal data. The Hub keeps it only as long as needed, can show a person everything we store, and can delete it on request." />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Due for anonymisation" value={dueTotal} tone={dueTotal ? "warn" : "default"} sub="past their retention period" />
        <Stat label="Consent on current notice" value={`${d.consent?.with_consent ?? 0}/${d.consent?.total ?? 0}`} sub="applications with a stored consent of the cycle's notice" />
        <Stat label="Suppressed addresses" value={d.suppressions.length} sub="never e-mailed again" />
        <Stat label="Retention job" value="daily" sub="06:00 UTC via Vercel Cron" />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div><CardTitle>Storage limitation (Art. 5)</CardTitle><CardDescription>Rejected, withdrawn and declined applications are anonymised after the cycle&apos;s retention period: CV deleted, name and contact replaced, comments removed. Scores stay for statistics.</CardDescription></div>
            <RetentionButton due={dueTotal} />
          </CardHeader>
          <Table>
            <THead><TR><TH>Cycle</TH><TH>Status</TH><TH className="text-right">Keep for</TH><TH className="text-right">Anonymised</TH><TH className="text-right">Due now</TH></TR></THead>
            <TBody>
              {d.cycles.map((c) => (
                <TR key={c.name}>
                  <TD className="font-medium">{c.name}<div className="text-[12px] font-normal text-ink-3">privacy notice {c.privacy_notice_version ?? "–"}</div></TD>
                  <TD className="text-ink-2">{c.status}</TD>
                  <TD className="text-right tabular">{c.retention_days} days</TD>
                  <TD className="text-right tabular">{c.anonymized}/{c.total}</TD>
                  <TD className="text-right tabular">{d.due.find((x) => x.cycle_name === c.name)?.n ?? 0}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>Right of access (Art. 15)</CardTitle><CardDescription>Everything stored about one person - profile, applications, scores, e-mails, outreach history - as a JSON file. Other people&apos;s names are left out.</CardDescription></div></CardHeader>
            <CardContent><AccessRequest /></CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Right to erasure (Art. 17)</CardTitle><CardDescription>Deletes the person, anonymises their applications, removes them from outreach and blocks the address from future e-mails.</CardDescription></div></CardHeader>
            <CardContent><ErasureRequest /></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><div><CardTitle>Suppression list</CardTitle><CardDescription>Checked before every single e-mail: unsubscribes, bounces, erasure requests and manual blocks</CardDescription></div></CardHeader>
          <CardContent className="divide-y divide-line pt-0">
            {d.suppressions.map((s) => <SuppressionRow key={s.id} s={s} />)}
            {!d.suppressions.length ? <p className="py-3 text-[13px] text-ink-3">Empty.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Recent privacy events</CardTitle><CardDescription>From the audit log</CardDescription></div></CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            {d.events.map((e, i) => (
              <div key={i} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
                <div><div className="font-medium">{e.action}</div><div className="text-[12px] text-ink-3">{e.actor ?? "system"} · {JSON.stringify(e.details).slice(0, 90)}</div></div>
                <span className="shrink-0 text-[12px] text-ink-3">{format(new Date(e.at), "d MMM, HH:mm")}</span>
              </div>
            ))}
            {!d.events.length ? <p className="text-ink-3">No privacy events yet.</p> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
