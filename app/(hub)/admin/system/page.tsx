import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { RetryEmailsButton } from "@/components/admin/admin-tools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { format, formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "System" };

type JobReport = Record<string, { ok: boolean; ms: number; error?: string }>;

async function load(userId: string) {
  const t = Date.now();
  const data = await withUser(userId, async (sql) => ({
    version: (await sql<{ v: string | null }[]>`select app.schema_version() as v`)[0]?.v,
    outbox: await sql<{ status: string; n: number }[]>`select status::text, count(*)::int as n from email_outbox group by 1 order by 1`,
    sentToday: (await sql<{ n: number }[]>`select count(*)::int as n from email_outbox where status = 'sent' and sent_at > date_trunc('day', now())`)[0]?.n ?? 0,
    failed: await sql<{ id: string; to_email: string; subject: string; last_error: string | null }[]>`
      select id, to_email::text, subject, last_error from email_outbox where status = 'failed' order by created_at desc limit 10`,
    jobs: await sql<{ at: string; details: JobReport }[]>`select at, details from audit_log where action = 'system.daily_jobs' order by at desc limit 7`,
    ai: (await sql<{ runs: number; usd: number; failed: number }[]>`
      select count(*)::int as runs, coalesce(sum(cost_usd), 0)::float as usd, count(*) filter (where status = 'failed')::int as failed
      from ai_runs where created_at > date_trunc('month', now())`)[0],
    sizes: await sql<{ table: string; rows: number }[]>`
      select relname as table, n_live_tup::int as rows from pg_stat_user_tables where schemaname = 'public' order by n_live_tup desc limit 8`,
  }));
  return { ...data, dbMs: Date.now() - t };
}

export default async function SystemPage() {
  const admin = await requireRole("admin");
  const d = await load(admin.id);
  const dbMs = d.dbMs;
  const e = env();
  const prod = process.env.NODE_ENV === "production";
  const config: [string, string, boolean][] = [
    ["Sign-in", e.AUTH_PROVIDER === "supabase" ? `Google Workspace via Supabase (${e.ALLOWED_EMAIL_DOMAINS.join(", ") || "no domain set!"})` : "Demo personas",
      e.AUTH_PROVIDER !== "supabase" || e.ALLOWED_EMAIL_DOMAINS.length > 0],
    ["E-mail delivery", e.EMAIL_PROVIDER === "resend" ? `Resend (from ${e.EMAIL_FROM})` : "Logged only - nothing leaves the Hub", true],
    ["File storage", e.STORAGE_BACKEND === "supabase" ? "Supabase Storage (private buckets)" : e.STORAGE_BACKEND === "disk" ? "Local disk" : "Database (demo)", true],
    ["AI features", e.AI_MODE === "live" ? `Live - ${e.AI_MODEL}` : e.AI_MODE === "mock" ? "Mock (no API calls)" : "Off", e.AI_MODE !== "live" || !!e.ANTHROPIC_API_KEY],
    ["Cron protection", e.CRON_SECRET ? "CRON_SECRET set" : "No CRON_SECRET - cron endpoints only run locally", !!e.CRON_SECRET || !prod],
    ["Public URL", e.APP_URL, !e.APP_URL.includes("localhost") || !prod],
  ];
  const outbox = (s: string) => d.outbox.find((o) => o.status === s)?.n ?? 0;

  return (
    <>
      <PageHeader eyebrow="Admin" title="System" description="Configuration, background jobs and e-mail delivery at a glance. Secrets are never shown." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Database" value={`${dbMs} ms`} sub={`schema ${d.version ?? "unknown"}`} />
        <Stat label="E-mails sent today" value={d.sentToday} sub={`${outbox("queued")} queued`} />
        <Stat label="Waiting for approval" value={outbox("needs_review")} sub="HR e-mails to check" />
        <Stat label="Failed e-mails" value={outbox("failed")} tone={outbox("failed") ? "danger" : "default"} sub="after 3 attempts" />
        <Stat label="AI this month" value={`$${(d.ai?.usd ?? 0).toFixed(2)}`} sub={`${d.ai?.runs ?? 0} calls · ${d.ai?.failed ?? 0} failed`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Configuration</CardTitle><CardDescription>Set through environment variables in Vercel</CardDescription></div></CardHeader>
          <CardContent className="space-y-2.5 text-[13.5px]">
            {config.map(([k, v, ok]) => (
              <div key={k} className="flex items-start gap-2">
                {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className="w-32 shrink-0 text-ink-3">{k}</span><span className="min-w-0 break-words">{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Daily jobs</CardTitle><CardDescription>Retention, follow-ups, lead scores and outbox - 06:00 UTC</CardDescription></div></CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            {d.jobs.map((j) => (
              <div key={j.at} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0">
                <span className="w-36 text-ink-2">{format(new Date(j.at), "d MMM, HH:mm")}</span>
                {Object.entries(j.details).map(([k, s]) => <Badge key={k} tone={s.ok ? "brand" : "danger"} title={s.error}>{k} {s.ok ? `${s.ms} ms` : "failed"}</Badge>)}
              </div>
            ))}
            {!d.jobs.length ? <p className="text-ink-3">No run recorded yet. On Vercel the first run happens at 06:00 UTC after deployment.</p>
              : <p className="text-[12px] text-ink-3">Last run {formatDistanceToNow(new Date(d.jobs[0].at))} ago</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Failed e-mails</CardTitle><CardDescription>The provider rejected them three times</CardDescription></div><RetryEmailsButton failed={outbox("failed")} /></CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            {d.failed.map((f) => (
              <div key={f.id} className="border-b border-line pb-2 last:border-0"><div className="font-medium">{f.subject}</div>
                <div className="text-[12px] text-ink-3">{f.to_email} · {f.last_error ?? "unknown error"}</div></div>
            ))}
            {!d.failed.length ? <p className="text-ink-3">None - all good.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Largest tables</CardTitle><CardDescription>Approximate row counts</CardDescription></div></CardHeader>
          <Table>
            <THead><TR><TH>Table</TH><TH className="text-right">Rows</TH></TR></THead>
            <TBody>{d.sizes.map((s) => <TR key={s.table}><TD className="font-mono text-[12.5px]">{s.table}</TD><TD className="text-right tabular">{s.rows.toLocaleString("en-GB")}</TD></TR>)}</TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
