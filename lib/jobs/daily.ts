import "server-only";
import { withService } from "@/lib/db";
import { processOutbox } from "@/lib/email/outbox";
import { recomputeScores } from "@/lib/outreach/score-job";
import { runSequences } from "@/lib/outreach/sequence-job";
import { runRetention } from "./retention";

type StepResult = { ok: true; ms: number; result: unknown } | { ok: false; ms: number; error: string };

async function step(fn: () => Promise<unknown>): Promise<StepResult> {
  const t = Date.now();
  try {
    const result = await fn();
    return { ok: true, ms: Date.now() - t, result };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: (err as Error).message.slice(0, 300) };
  }
}

/** Everything that has to happen once a day. Steps are independent: one failure does not block the rest. */
export async function runDailyJobs() {
  const report = {
    retention: await step(() => runRetention()),
    sequences: await step(() => withService((tx) => runSequences(tx))),
    scores: await step(async () => {
      const r = await withService((tx) => recomputeScores(tx as never));
      return { scored: r.scored, overall_win_rate: r.rates?.overall ?? null };
    }),
    outbox: await step(() => processOutbox(100)),
  };
  await withService((tx) => tx`select app.log_event('system.daily_jobs', 'system', null, ${tx.json(report as never)})`).catch(() => {});
  return report;
}
