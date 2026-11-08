import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/jobs/cron-auth";
import { runDailyJobs } from "@/lib/jobs/daily";

export const maxDuration = 60;

/** Daily at 06:00 UTC (vercel.json): GDPR retention, follow-up sequences, lead scores, outbox. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await runDailyJobs();
  const ok = Object.values(report).every((s) => s.ok);
  return NextResponse.json({ ok, report }, { status: ok ? 200 : 500 });
}
