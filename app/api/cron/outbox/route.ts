import { NextResponse } from "next/server";
import { withService } from "@/lib/db";
import { processOutbox } from "@/lib/email/outbox";
import { cronAuthorized } from "@/lib/jobs/cron-auth";
import { runSequences } from "@/lib/outreach/sequence-job";

export const maxDuration = 60;

/**
 * Frequent tick for throttled campaigns and follow-ups. Vercel Hobby only allows daily crons,
 * so .github/workflows/outbox-tick.yml calls this every 15 minutes (Pro plans can use vercel.json).
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sequences = await withService((tx) => runSequences(tx));
  const outbox = await processOutbox(60);
  return NextResponse.json({ ok: true, sequences, outbox });
}
